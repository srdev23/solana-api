# SPL token buy/sell on Raydium, Moonshot, Pumpfun using BloxRoute

This service provides a swap api for spl token buy/sell on Raydium, Moonshot, Pumpfun using BloxRoute.

## API Endpoints
   ### Raydium
   - Buy:
         POST https://localhost:3000/api/v1/raydium/buy

   - Sell:
         POST https://localhost:3000/api/v1/raydium/sell

   ### Moonshot

   - Buy:
         POST https://localhost:3000/api/v1/moonshot/buy

   - Sell:
         POST https://localhost:3000/api/v1/moonshot/sell

   ### Pumpfun

   - Buy:
         POST https://localhost:3000/api/v1/pumpfun/buy

   - Sell:
         POST https://localhost:3000/api/v1/pumpfun/sell

## Getting Started

To start this project, follow these steps:

1. Clone this repository to your local machine:

   ```bash
   git clone https://github.com/btcoin23/SwapAPI_BloXroute.git
   ```

2. Navigate to the project directory:

   ```bash
   cd SwapAPI_BloXroute
   ```

3. Install the project dependencies:

   ```bash
   npx yarn 
   ```
4. Create a `.env` file in the project root directory and add other necessary configuration.
   ```bash
   RPC_URL=
   AUTH_HEADER=
   FEE_RECEIVER_ADDRESS=
   SYSTEM_FEE=
   SOL_USD_PRICE=
   PORT=
   ```

5. Start the bot

   Run the following command to start the token creation process:

   ```bash
   npm start
   ```


## AUTHER
### @btcoin23
#### Github: https://github.com/btcoin23
#### TG: https://t.me/BTC0in23