export class CancelToken {
    static source () {
        const token = new CancelToken();

        return {
            token: token,
            cancel: () => token.cancel()
        }
    }

    protected cancelled = false;

    isCancelled () : boolean {
        return this.cancelled;
    }

    cancel () {
        this.cancelled = true;
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