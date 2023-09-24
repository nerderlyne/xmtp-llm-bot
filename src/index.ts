import { config } from "dotenv";
import {
  AttachmentCodec,
  RemoteAttachmentCodec,
} from "@xmtp/content-type-remote-attachment";
import {
  Client,
  ListMessagesOptions,
  SortDirection,
  DecodedMessage,
} from "@xmtp/xmtp-js";
import { utils, Wallet } from "ethers";
import OpenAI from "openai";

config();

/******************************** TYPES ********************************/

interface HandlerContextConstructor {
  message: DecodedMessage;
  history: OpenAI.Chat.ChatCompletionMessage[];
  client: Client;
}

type Handler = (message: HandlerContext) => Promise<void>;

/******************************** HELPERS ********************************/

async function createClient(): Promise<Client> {
  let wallet: Wallet;
  const key = process.env.KEY;

  if (key) {
    wallet = new Wallet(key);
  } else {
    wallet = Wallet.createRandom();
  }

  if (process.env.XMTP_ENV !== "production" && process.env.XMTP_ENV !== "dev") {
    throw "invalid XMTP env";
  }

  const client = await Client.create(wallet, {
    env: process.env.XMTP_ENV || "production",
  });

  // Register the codecs. AttachmentCodec is for local attachments (<1MB)
  client.registerCodec(new AttachmentCodec());
  //RemoteAttachmentCodec is for remote attachments (>1MB) using thirdweb storage
  client.registerCodec(new RemoteAttachmentCodec());

  await client.publishUserContact();

  return client;
}

const getConversationHistory = async (
  client: Client,
  userAddress: string,
): Promise<OpenAI.Chat.ChatCompletionMessage[]> => {
  const conversations = await client.conversations.list();
  const conversation = conversations.find((conversation) => {
    return (
      utils.getAddress(conversation.peerAddress) ==
      utils.getAddress(userAddress)
    );
  });

  if (!conversation) {
    return [];
  }

  const options: ListMessagesOptions = {
    checkAddresses: true,
    limit: 5,
    direction: SortDirection.SORT_DIRECTION_DESCENDING,
  };

  const messages = await conversation.messages(options);

  messages.shift();
  if (messages.length === 0) {
    return [];
  }

  return messages
    .map((message) => {
      return {
        role:
          message.senderAddress == client.address
            ? "assistant"
            : ("user" as OpenAI.Chat.ChatCompletionMessage["role"]),
        content: message.content,
      };
    })
    .reverse();
};

/******************************** MAIN ********************************/

const llm = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class HandlerContext {
  message: DecodedMessage;
  history: OpenAI.Chat.ChatCompletionMessage[];
  client: Client;

  constructor({ message, history, client }: HandlerContextConstructor) {
    this.message = message;
    this.history = history;
    this.client = client;
  }

  async reply(content: any) {
    await this.message.conversation.send(content);
  }
}

export const handleChat = async (context: HandlerContext) => {
  try {
    if (context.message.contentType.typeId != "text") {
      await context.reply("Sorry, I only understand text messages.");
      return;
    }

    let messageBody = context.message.content;
    const messageHistory = context.history;

    const response = (
      await llm.chat.completions.create({
        model: "gpt-3.5-turbo-0613",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant.",
          },
          ...messageHistory,
          {
            role: "user",
            content: messageBody,
          },
        ],
      })
    ).choices[0].message.content;

    if (!response) {
      await context.reply(
        "Sorry, my systems are under repair. Please chat with me later when we are all fixed ♥",
      );
      return;
    }

    await context.reply(response);
  } catch (error) {
    console.error(`Error: ${error}`);
    await context.reply("Sorry, an error occurred. Please try again later.");
  }
};

async function run(handler: Handler) {
  const client = await createClient();

  console.log(`Listening on ${client.address}`);

  for await (const message of await client.conversations.streamAllMessages()) {
    try {
      if (message.senderAddress == client.address) {
        continue;
      }

      const history = await getConversationHistory(
        client,
        utils.getAddress(message.senderAddress),
      );

      const context = new HandlerContext({ message, history, client });

      await handler(context);
    } catch (e) {
      console.log(`error`, e, message);
    }
  }
}

const reconnect = async (handler: Handler, retries: number = 5) => {
  try {
    await run(handler);
    console.log("Done");
  } catch (e: any) {
    if (retries > 0) {
      console.log(`Error occurred, retrying... (${retries} retries left)`);
      await reconnect(handler, retries - 1);
    } else {
      console.error("Error", e);
    }
  }
};

reconnect(handleChat);
