export interface CutTimemapSegment {
    originalStart : number;
    targetStart : number;
    length : number;
}

export interface Timemap {
    clone () : Timemap;

    get ( time : number ) : number;
}

export class IdentityTimemap implements Timemap {
    get ( time : number ) : number {
        return time;
    }

    clone () : IdentityTimemap {
        return this;
    }
}

export class CutTimemap implements Timemap {
    protected segments : CutTimemapSegment[];

    public constructor ( segments : CutTimemapSegment[] = [] ) {
        this.segments = segments;
    }

    public add ( originalStart : number, targetStart : number, length : number ) : this {
        this.segments.push( { originalStart, targetStart, length } );

        return this;
    }

    public get ( time : number ) : number {
        for ( let segment of this.segments ) {
            if ( time >= segment.originalStart && time <= segment.originalStart + segment.length ) {
                return segment.targetStart + ( time - segment.originalStart );
            }
        }

        return null;
    }

    public clone () : CutTimemap {
        return new CutTimemap( this.segments.map( seg => ( { ...seg } ) ) );
    }
}