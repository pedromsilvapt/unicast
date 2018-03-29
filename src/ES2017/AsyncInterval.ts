import { differenceInMilliseconds } from 'date-fns'

export class AsyncInterval {
    protected callback : ( ...args : any[] ) => void;

    protected ms : number;

    protected timeout ?: NodeJS.Timer;

    protected timestamp ?: Date;

    constructor ( callback : ( ...args : any[] ) => Promise<void>, ms : number ) {
        this.callback = callback;
        this.ms = ms;

        this.schedule();
    }

    protected schedule () {
        const ms = this.timestamp ? Math.abs( differenceInMilliseconds( new Date(), this.timestamp ) ) % this.ms : this.ms;

        this.timeout = setTimeout( this.trigger.bind( this ), ms );

        this.timestamp = new Date();
    }

    protected async trigger () {
        this.timestamp = null;

        await this.callback();

        if ( this.timeout ) {
            this.schedule();
        } else {
            this.timestamp = new Date();
        }
    }

    sleep () {
        if ( this.timeout ) {
            clearTimeout( this.timeout );

            this.timeout = null;
        }
    }

    awake () {
        if ( !this.timeout && this.timestamp ) {
            this.schedule();
        }
    }

    clear () {
        this.sleep();

        this.timestamp = null;
    }
}

export function setAsyncInterval ( callback : ( ...args : any[] ) => Promise<void>, ms : number ) {
    return new AsyncInterval( callback, ms );
}

export function clearAsyncInterval ( interval : AsyncInterval ) {
    interval.clear();
}