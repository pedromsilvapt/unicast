import { PassThrough } from 'stream';
import extend from 'extend';
import Kefir from 'kefir';

export default class TranscodingProcess extends PassThrough {
	constructor ( transcoder ) {
		super();

		this.transcoder = transcoder;

		this.progress = Kefir.stream( emitter => {
			transcoder.on( 'error', this.onError.bind( this, emitter ) );

			transcoder.on( 'progress', this.onProgress.bind( this, emitter ) );

			transcoder.on( 'finish', this.onFinish.bind( this, emitter ) );
		} );

		this.progress.throttle( 3000 ).filter( () => !this.ended ).onValue( value => console.log( value.speed + ' /s', value.timeFormatted, value.time, value.frame ) );

		this.lastBench = null;
		this.lastTime = null;
		this.locked = false;

		this.resources = new Map();
		this.connections = 0;

		this.started = false;
		this.killed = false;
		this.error = false;
	}

	get paused () {
		return this.stdout.isPaused();
	}

	lock () {
		this.locked = true;

		return this;
	}

	unlock () {
		this.locked = false;

		return this;
	}

	formatTime ( duration ) {
		let milliseconds = duration % 1000;

		let seconds = parseInt( duration / 1000, 10 ) % 60;

		let minutes = parseInt( duration / ( 60 * 1000 ), 10 ) % 60;

		let hours = parseInt( duration / ( 60 * 60 * 1000 ), 10 );

		return [ hours, minutes, seconds, milliseconds ];
	}

	elapsedTime ( start, precision = 3 ) {
		let elapsed = process.hrtime( start );

		let milliseconds = elapsed[ 1 ] / 1000000;

		return ( elapsed[ 0 ] * 1000 ) + parseFloat( milliseconds.toFixed( precision ) );
	}

	onError ( emitter, error ) {
		this.ended = true;
		this.error = true;

		emitter.error( error );

		if ( error.message !== 'FFmpeg error: Stream mapping:' ) {
			throw error;
		}
	}

	onProgress ( emitter, progress ) {
		if ( this.ended || !this.started ) {
			return;
		}

		if ( this.lastBench !== null ) {
			let value = extend( {}, progress );
			value.diff = this.elapsedTime( this.lastBench );
			value.speed = ( value.time ) / value.diff;
			value.timeFormatted = this.formatTime( value.time  ).join( ':' );

			emitter.emit( value );
		} else {
			console.log( progress.time );

			this.lastBench = process.hrtime();
		}

		this.lastTime = progress.time;
	}

	onFinish ( emitter ) {
		this.ended = true;

		emitter.end();

		console.log( 'finish' );
	}

	get args () {
		return this.transcoder._compileArguments().concat( [ 'pipe:1' ] );
	}

	get argsString () {
		return this.args.join( ' ' );
	}

	exec () {
		return this.transcoder._exec( this.args );
	}

	createReader ( offset = {} ) {
		if ( !this.started ) {
			this.start();
		}

		let reader = this.stream.createReader( offset );

		this.connection( reader );

		reader.on( 'end', this.release.bind( this, reader ) );
		reader.on( 'close', this.release.bind( this, reader ) );

		return reader;
	}

	end () {
		this.child.kill( 'SIGKILL' );

		this.ended = true;
		this.killed = true;
	}

	connection ( resource = null, autoStart = true ) {
		if ( !this.started && autoStart ) {
			this.start = true;
		}

		if ( resource ) {
			if ( this.resources.has( resource ) ) {
				return;
			}

			this.resources.set( resource, true );
		}

		this.connections += 1;

		if ( this.paused ) {
			this.stdout.resume();
		}

		return this;
	}

	release ( resource = null ) {
		if ( resource ) {
			if ( !this.resources.has( resource ) ) {
				return;
			}

			this.resources.delete( resource );
		}

		if ( this.connections > 0 ) {
			this.connections -= 1;
		}

		console.log( this.connections, this.locked );
		if ( this.connections === 0 && !this.locked ) {
			this.stdout.pause();
		}

		return this;
	}

	start ( passtrough = null ) {
		if ( this.started ) {
			if ( this.paused ) {
				this.stdout.resume();
			}

			return this;
		}

		this.started = true;

		this.child = this.exec();

		this.stdout = this.child.stdout;

		if ( passtrough ) {
			this.stream = this.stdout.pipe( passtrough );
		} else {
			this.stream = this.stdout;
		}

		this.stream.pipe( this );

		return this;
	}
}