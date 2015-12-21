import commander from 'commander';

export default class Application {
	constructor ( program = null ) {
		if ( !program ) {
			program = commander;
		}

		this.program = program;
		this.commands = {};
	}

	register ( command ) {
		this.commands[ command.name ] = command;

		command.register( this.program ).action( this.execute.bind( this, command.name ) );
	}

	execute ( name, ...args ) {
		Promise.resolve( this.commands[ name ].execute( ...args ) ).catch( ( error ) => {
			console.error( 'ERROR', error.message, error.stack );
		} );
	}

	parse ( argv = null ) {
		if ( !argv ) {
			argv = process.argv;
		}

		this.program.parse( argv );
	}
}