export default class Command {
	constructor () {

	}

	get usage () {
		let usage = this.name;

		if ( this.args ) {
			usage += ' ' + this.args;
		}

		return usage;
	}

	execute () {
		throw new Error( 'Command "' + this.name + '" not implemented' );
	}

	register ( program ) {
		let cmd = program.command( this.usage );

		if ( this.alias ) {
			cmd.alias( this.alias );
		}

		if ( this.description ) {
			cmd.description( this.description );
		}

		if ( this.options ) {
			for ( let option of this.options ) {
				cmd.option( ...option );
			}
		}

		return cmd;
	}
}