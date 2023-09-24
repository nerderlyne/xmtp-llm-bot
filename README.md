# XMTP LLM Bot Starter

This project deploys a text-based chatgpt-like bot on xmtp network. 

### Usage

#### Install Dependencies 

```bash
pnpm i
```

#### Start the Bot 

```bash
pnpm run build
```

#### Keeping the same address (the `KEY` environment variable)

By default, your bot will have a new address every time you start it up. That's ideal. If you have a private key, you can encode it to a hex string and set the `KEY` environment variable. Your bot will then use this key to connect to the network.

```bash
pnpx tsx gen-wallet.ts
```

This will print the generated wallet address and the private key. 

### XMTP Environment (the `XMTP_ENV` environment variable)

By default, the bot connects to the `dev` network. If you want to connect to production, specify `XMTP_ENV=production`.

### Credits

Adapted from (XMTP Bot Starter)[https://github.com/xmtp/xmtp-bot-starter]