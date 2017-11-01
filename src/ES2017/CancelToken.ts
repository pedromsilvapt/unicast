import { Deferred } from "./Deferred";

export class CancelToken {
    static source () {
        const token = new CancelToken();

        return {
            token: token,
            cancel: () => token.cancel()
        }
    }

    protected whenCancelledDeferred : Deferred<void> = new Deferred();
    
    protected cancelled = false;

    whenCancelled () : Promise<void> {
        return this.whenCancelledDeferred.promise;
    }

    isCancelled () : boolean {
        return this.cancelled;
    }

    cancel () {
        if ( !this.cancelled ) {
            this.cancelled = true;
    
            this.whenCancelledDeferred.resolve();
        }
    }

    throwIfCancelled () : void {
        if ( this.isCancelled() ) {
            throw new CancelledTokenError();
        }
    }
}

export class CancelledTokenError extends Error {
    constructor () {
        super( 'Cancelled Token' );
    }
}