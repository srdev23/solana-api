import { createLogger, format, transports } from 'winston';
import path from 'path';
import fs from 'fs';
import morgan, { StreamOptions } from 'morgan';
import { Request, Response, NextFunction } from 'express';

// Ensure the logs directory exists
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Create a logger instance
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new transports.File({ filename: path.join(logDir, 'node.log'), maxsize: 5242880, maxFiles: 5 }), // 5MB max size, 5 max files
    new transports.Console()
  ],
});

const stream: StreamOptions = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Setup morgan to use winston's stream
const morganMiddleware = morgan('combined', { stream });

// Middleware to log responses
const logResponses = (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send;

  res.send = function (body?: any) {
    logger.info(`Response: ${body}`);
    return originalSend.apply(res, [body]);
  };

  next();
};

export { logger, morganMiddleware, logResponses };