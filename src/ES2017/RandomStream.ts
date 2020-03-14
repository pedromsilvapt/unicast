import { Readable } from 'stream';

export class RandomStream extends Readable {
    randAscii : () => number;
    
    constructor () {
        super();

        this.randAscii = randIntGenerator( 33, 126 );
    }

    _read ( n ) {
        const buffer = Buffer.alloc( n || 16384 );

        let done = 0;

        while ( done < buffer.length ) {
            buffer.writeInt32LE( this.randAscii(), done );

            done += 4;
        }

        this.push( buffer );
    }
    
    randChar () {
        return String.fromCharCode(this.randAscii());
    }
}

function randIntGenerator ( min, max ) {
    if (!min) min = 50;
    if (!max) max = 250;

    return function () {
        return Math.floor( Math.random() * ( max - min + 1 ) ) + min;
    };
}

