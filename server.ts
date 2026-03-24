import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { morganMiddleware, logResponses } from './logger';
import raydiumSwap from './src/raydiumSwap';
import moonshotSwap from './src/moonshotSwap';
// import pumpfunSwap from './src/pumpfunSwap';
import pumpfunSwap from './test';
import { PORT } from './config';

const app = express();
app.set('trust proxy', true); // Adjust based on your proxy setup (e.g., 'trust proxy', 1 for single proxy)
// Middlewares
app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());
app.use(morganMiddleware);
app.use(logResponses);

// Routes
app.use('/api/v1/raydium', raydiumSwap); // Use the default export for the Raydium buy route`
app.use('/api/v1/moonshot/', moonshotSwap); // Use the new buy moonshot route
app.use('/api/v1/pumpfun/', pumpfunSwap); // Use the new buy pump.fun route

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});