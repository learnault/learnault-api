import winston from 'winston'

const isProduction = process.env.NODE_ENV === 'production'

// JSON format for production (better for log aggregation)
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
)

// Human-readable format for development
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = ''
    if (Object.keys(meta).length > 0) {
      metaStr = JSON.stringify(meta, null, 2)
    }

    return `${timestamp} [${level}]: ${message}${metaStr ? '\n' + metaStr : ''}`
  }),
)

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isProduction ? jsonFormat : devFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
  // Don't exit on uncaught exceptions - let the process handle it
  exitOnError: false,
})

export default logger
