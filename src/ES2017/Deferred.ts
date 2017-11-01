export class Deferred<T> {
    promise : Promise<T>;

    isResolved : boolean = false;
    isRejected : boolean = false;

    protected resolvedValue : T | PromiseLike<T> = null;
    protected rejectedValue : any = null;

    protected internalResolve : ( value ?: T | PromiseLike<T> ) => void;
    protected internalReject : ( reason ?: any ) => void;

    constructor () {
        this.promise = new Promise<T>( ( resolve, reject ) => {
            if ( this.isResolved ) {
                resolve( this.resolvedValue );
            } else {
                this.internalResolve = resolve;
            }

            if ( this.isRejected ) {
                reject( this.rejectedValue );
            } else {
                this.internalReject = reject;
            }
        } );
    }

    resolve ( value ?: T | PromiseLike<T> ) : void {
        if ( this.isRejected || this.isResolved ) {
            return void 0;
        }

        this.isResolved = true;

        if ( this.internalResolve ) {
            this.internalResolve( value );
        } else {
            this.resolvedValue = value;
        }

        return void 0;
    }

    reject ( reason ?: any ) : void {
        if ( this.isRejected || this.isResolved ) {
            return void 0;
        }

        this.isRejected = true;

        if ( this.internalReject ) {
            this.internalReject( reason );
        } else {
            this.rejectedValue = reason;
        }

        return void 0;
    }
}