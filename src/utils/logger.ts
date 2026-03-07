import configLogger from '../config/logger'

export type LogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'http'
  | 'verbose'
  | 'debug'
  | 'silly';

const logger = {
  error: (message: string, meta?: any) => configLogger.error(message, meta),
  warn: (message: string, meta?: any) => configLogger.warn(message, meta),
  info: (message: string, meta?: any) => configLogger.info(message, meta),
  http: (message: string, meta?: any) => configLogger.http(message, meta),
  verbose: (message: string, meta?: any) => configLogger.verbose(message, meta),
  debug: (message: string, meta?: any) => configLogger.debug(message, meta),
  silly: (message: string, meta?: any) => configLogger.silly(message, meta),
  setLevel: (level: LogLevel) => {
    configLogger.level = level
  },
}

export default logger
