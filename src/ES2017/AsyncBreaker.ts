export class AsyncBreaker {
    public _last : number | null = null;
    
    public intervalInMs : number = 100;
    
    public async tryBreak() {
        if ( this._last != null ) {
            const now = new Date().getTime();
            
            const shouldBreak = now - this._last >= this.intervalInMs;
            
            
            if ( shouldBreak ) {
                this._last = now;
                
                await new Promise( resolve => setTimeout( resolve, 1 ) );
            }
        } else {
            this._last = new Date().getTime();
        }
    }
}
