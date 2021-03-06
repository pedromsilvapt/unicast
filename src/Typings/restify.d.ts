import { LiveLogger } from 'clui-logger';
import { AccessCard } from '../AccessControl';
import { Stopwatch } from '../BackgroundTask';
import { HttpRequestLoggerHFP } from '../UnicastServer';

declare module "restify" {
    export interface Request {
        live ?: LiveLogger;
        stopwatch ?: Stopwatch;
        hfp ?: HttpRequestLoggerHFP;
        identity ?: AccessCard;
    }
}
