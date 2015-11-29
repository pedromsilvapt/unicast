import Controller from './Controller';

export default class MasterController extends Controller {
	static routes ( router, make ) {
		router.get( '/restart', this.action( 'restart' ) );
	}

	* restart () {
		console.log( 'Restarting' );

		let status = yield this.server.restart();

		console.log( 'Restarted' );

		return status;
	}

}