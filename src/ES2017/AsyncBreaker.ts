export class AsyncBreaker {
    public _last : number | null = null;

    public intervalInMs : number = 100;

    public breakMs : number = 1;

    public async tryBreak() {
        if ( this._last != null ) {
            const now = new Date().getTime();

            const shouldBreak = now - this._last >= this.intervalInMs;


            if ( shouldBreak ) {
                this._last = now;

                await new Promise( resolve => setTimeout( resolve, this.breakMs ) );
            }
        } else {
            this._last = new Date().getTime();
        }
    }
}
