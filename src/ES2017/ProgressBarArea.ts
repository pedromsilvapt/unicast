import { LiveComponent } from 'clui-live';

export interface ProgressBarState {
    title ?: string;
    progress : number;
    leftLabel ?: string;
    rightLabel ?: string;
}

export class ProgressBarLiveComponent extends LiveComponent<ProgressBarState> {
    maxWidth : number = Infinity;

    protected calculateBarWidth ( maxWidth : number ) : number {
        let remaining = maxWidth;

        if ( this.state.leftLabel ) {
            remaining -= this.state.leftLabel.length + 2;
        }

        if ( this.state.rightLabel ) {
            remaining -= this.state.rightLabel.length + 4;
        }

        // Percentage counter
        remaining -= 9;

        return remaining;
    }

    render () {
        const width = this.calculateBarWidth( Math.min( this.maxWidth, this.renderer.width ) );

        const done = Math.max( 0, Math.min( 100, this.state.progress ) );

        let buffer : string[] = [];

        if ( this.state.title ) {
            buffer.push( this.state.title + '\n' );
        }

        if ( this.state.leftLabel ) {
            buffer.push( `${ this.state.leftLabel } |` );
        }

        const doneWidth = Math.max( 0, Math.min( width, Math.round( done * width / 100 ) ) );

        const missingWidth = width - doneWidth;

        const percentage = ( '' + Math.round( this.state.progress * 100 ) / 100 ).padStart( 6, ' ' );
        
        buffer.push( '\u2588'.repeat( doneWidth ) + '\u2591'.repeat( missingWidth ) + `| ${ percentage }%` );

        if ( this.state.rightLabel ) {
            buffer.push( ` || ${ this.state.rightLabel }` );
        }

        return buffer.join( '' );
    }
}