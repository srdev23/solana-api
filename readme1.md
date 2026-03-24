# Solana Swap API (BloxRoute) [Project ID: P-182, P-183]

A swap API service for SPL token buy/sell on Raydium, Moonshot, and Pump.fun using BloxRoute for fast execution.



📚 Table of Contents
[About](#about)
[Features](#features)
[Tech Stack](#tech-stack)
[Installation](#installation)
[Usage](#usage)
[Configuration](#configuration)
[Screenshots](#screenshots)
[API Documentation](#api-documentation)
[Contact](#contact)



🧩 About
This project provides an HTTP API for trading SPL tokens across multiple Solana DEXs (Raydium, Moonshot, Pump.fun) with BloxRoute integration for low-latency execution. It solves the need for a unified, programmable interface to execute swaps from external systems.



✨ Features
Raydium swap – buy/sell SPL tokens on Raydium
Moonshot swap – buy/sell on Moonshot
Pump.fun swap – buy/sell on Pump.fun
BloxRoute integration – fast, reliable order routing
REST API – simple POST endpoints for each DEX



🧠 Tech Stack
Languages: TypeScript, JavaScript
Frameworks: Express.js
Libraries: Raydium SDK, Moonshot SDK, BloxRoute Solana Trader Client, Solana web3.js, Metaplex



Installation

# Navigate to the project directory
cd SolanaApis

# Install dependencies
npx yarn



🚀 Usage
# Start the server
npm start

Then open your browser or call the API at:
👉 [http://localhost:3000](http://localhost:3000)



🧾 Configuration
Create a `.env` file in the project root with:

RPC_URL=your_solana_rpc_url
AUTH_HEADER=your_bloxroute_auth_header
FEE_RECEIVER_ADDRESS=your_fee_receiver_wallet
SYSTEM_FEE=optional_fee_config
SOL_USD_PRICE=optional_sol_price
PORT=3000



📜 API Documentation
Raydium:
- POST /api/v1/raydium/buy – Buy SPL token on Raydium
- POST /api/v1/raydium/sell – Sell SPL token on Raydium

Moonshot:
- POST /api/v1/moonshot/buy – Buy on Moonshot
- POST /api/v1/moonshot/sell – Sell on Moonshot

Pump.fun:
- POST /api/v1/pumpfun/buy – Buy on Pump.fun
- POST /api/v1/pumpfun/sell – Sell on Pump.fun
