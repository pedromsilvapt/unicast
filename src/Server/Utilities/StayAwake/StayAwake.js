export default class StayAwake {
	constructor () {
		// Number of times awake has been called.
		// Decreases with every sleep call
		this.queue = 0;
	}


	async turnOn () {

	}

	async turnOff () {

	}

	async run ( fn ) {
		await this.awake();

		let result = await Promise.resolve( fn() );

		await this.sleep();

		return result;
	}

	async awake () {
		this.queue += 1;

		if ( this.queue == 1 ) {
			await this.turnOn();
		}
	}

	async sleep ( force = false ) {
		if ( force ) {
			this.queue = 0;
		} else {
			this.queue = Math.max( 0, this.queue - 1 );
		}

		if ( this.queue == 0 ) {
			await this.turnOff();
		}
	}
}