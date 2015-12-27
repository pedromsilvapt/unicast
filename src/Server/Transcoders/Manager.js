import StreamTranscoder from 'stream-transcoder';
import TranscodingProcess from './Process';
import RulesSet from './Rules/Set';

export default class TranscodersManager {
	constructor ( parent = null ) {
		this.parent = parent;
		this.root = parent ? this.parent.root : this;

		this.processes = new Map();

		this.criteria = [];
	}

	register ( transcoders ) {
		this.criteria.push( transcoders );

		return this;
	}

	matched ( metadata ) {
		let matched = [];

		for ( let criteria of this.criteria ) {
			if ( criteria.matches( metadata ) ) {
				matched.push( criteria );
			}
		}

		if ( this.parent ) {
			matched = this.parent.matched( metadata ).concat( matched );
		}

		return matched;
	}

	matches ( metadata ) {
		return this.matched( metadata ).length > 0;
	}

	create ( source, metadata ) {
		let matched = new RulesSet( this.matched( metadata ) );

		let transcoder = new StreamTranscoder( source );

		transcoder = matched.convert( transcoder, metadata );

		return new TranscodingProcess( transcoder );
	}

	spawn ( source, metadata, passthrough = null ) {
		let process = this.create( source, metadata );

		return process.start( passthrough );
	}

	request ( source, metadata, key = null, passtrough = null ) {
		let transcodingProcess;

		if ( key !== null ) {
			transcodingProcess = this.processes.get( key );
		}

		if ( !transcodingProcess ) {
			transcodingProcess = this.spawn( source, metadata, passtrough );
		}

		if ( key !== null ) {
			this.processes.set( key, transcodingProcess );
		}

		return transcodingProcess;
	}
}