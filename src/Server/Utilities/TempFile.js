import Deferred from './Deferred';
import tailing from 'tailing-stream';
import fs from 'fs-promise';

export default class TempFile {
	constructor ( input ) {
		this.path = 'D:\\Pedro Silva\\Desktop\\Encoded.mkv';
		this.writer = fs.createWriteStream( this.path );
		this.readyController = new Deferred();

		input.pipe( this.writer );

		this.writer.on( 'open', () => { console.log( 'OPPPPPPPPPPPPPPPPPPPPPPPPPPPPPEN' ); this.readyController.resolve( this.reader ) } );
	}

	get ready () {
		return this.readyController.promise;
	}

	get reader () {
		if ( !this._reader ) {
			this._reader = tailing.createReadStream( this.path );
		}

		this._reader.on( 'data', d => console.log( d.length ) );
		this._reader.on( 'end', d => console.log( 'end' ) );

		return this._reader;
	}
}