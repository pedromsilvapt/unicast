export class DataAmountParseError extends Error { }

abstract class Amount<U extends number, A extends Amount<U, A>> {
    readonly value : number;
    readonly unit : U;

    protected abstract exchangeRates : { unit: U, multiplier : number }[];

    constructor ( value : number, unit : U ) {
        this.value = value;
        this.unit = unit;
    }

    protected create ( value : number, unit : U ) : A {
        return new ( this.constructor as any )( value, unit );
    }
    
    protected unaryOp ( op : ( a : number ) => number ) {
        return this.create( op( this.value ), this.unit );
    }
    
    protected binaryOp ( value : number | string | A, op : ( a : number, b : number ) => number ) {
        if ( typeof value === 'number' ) {
            return this.create( op( this.value, value ), this.unit );
        } else {
            const amount : A = ( this.constructor as any ).parse( value );

            return this.create( op( this.value, amount.as( this.unit ) ), this.unit );
        }
    }

    protected ternaryOp ( value1 : number | string | A, value2 : number | string | A, op : ( a : number, b : number, c : number ) => number ) {
        const value1Number = typeof value1 === 'number' ? value1 : ( this.constructor as any ).parse( value1 ).as( this.unit );
        const value2Number = typeof value2 === 'number' ? value2 : ( this.constructor as any ).parse( value2 ).as( this.unit );

        return this.create( op( this.value, value1Number, value2Number ), this.unit );
    }

    convert ( unit : U ) : A {
        return this.create( this.as( unit ), unit );
    }

    as ( unit : U = this.unit, decimals : number = null ) : number {
        let value = this.value;

        if ( unit < this.unit ) {
            for ( let i : number = this.unit; i > unit; i-- ) {
                value *= this.exchangeRates[ i ].multiplier;
            }
        } else if ( unit > this.unit ) {
            for ( let i : number = this.unit + 1; i <= unit; i++ ) {
                value /= this.exchangeRates[ i ].multiplier;
            }
        }

        if ( typeof decimals === 'number' ) {
            if ( decimals > 0 ) {
                const exp = Math.pow( 10, decimals );
    
                value = Math.round( value * exp ) / exp;
            } else if ( decimals === 0 ) {
                value = Math.round( value );
            }
        }

        return value;
    }

    div ( value : number | string | A ) {
        return this.binaryOp( value, ( a, b ) => a / b );
    }

    mul ( value : number | string | A ) {
        return this.binaryOp( value, ( a, b ) => a * b );
    }

    plus ( value : number | string | A ) {
        return this.binaryOp( value, ( a, b ) => a + b );
    }

    minus ( value : number | string | A ) {
        return this.binaryOp( value, ( a, b ) => a - b );
    }

    floor () {
        return this.unaryOp( a => Math.floor( a ) );
    }
    
    ceil () {
        return this.unaryOp( a => Math.ceil( a ) );
    }
    
    round ( decimals : number = 0 ) {
        if ( decimals > 0 ) {
            const exp = Math.pow( 10, decimals );

            return this.unaryOp( a => Math.round( a * exp ) / exp );
        } else {
            return this.unaryOp( a => Math.round( a ) );
        }
    }

    clamp ( min : number | string | A, max : number | string | A ) {
        return this.ternaryOp( min, max, ( v, min, max ) => Math.max( min, Math.min( v, max ) ) );
    }

    atMost ( max : number | string | A ) {
        return this.binaryOp( max, ( v, max ) => Math.min( v, max ) );
    }

    atLeast ( min : number | string | A ) {
        return this.binaryOp( min, ( v, min ) => Math.max( v, min ) );
    }

    unitToString () {
        return '' + this.unit;
    }

    toString () {
        return `${this.value} ${ this.unitToString() }`;
    }
}

export enum DataUnit {
    BITS = 0,
    BYTES = 1,
    KILOBITS = 2,
    KILOBYTES = 3,
    MEGABITS = 4,
    MEGABYTES = 5,
    GIGABITS = 6,
    GIGABYTES = 7,
    TERABITS = 8,
    TERABYTES = 9,
}

export class DataAmount extends Amount<DataUnit, DataAmount> {
    static pattern = /([0-9]+)(\.[0-9]+)?([KMGkmg][bB]?|[bB])?/;

    static unitKeywords = {
        'b': DataUnit.BITS,
        'B': DataUnit.BYTES,

        'kb': DataUnit.KILOBYTES,
        'kB': DataUnit.KILOBYTES,
        'KB': DataUnit.KILOBYTES,
        'Kb': DataUnit.KILOBITS,
        
        'mb': DataUnit.MEGABYTES,
        'mB': DataUnit.MEGABYTES,
        'MB': DataUnit.MEGABYTES,
        'Mb': DataUnit.MEGABITS,

        'gb': DataUnit.GIGABYTES,
        'gB': DataUnit.GIGABYTES,
        'GB': DataUnit.GIGABYTES,
        'Gb': DataUnit.GIGABITS,
  
        'tb': DataUnit.TERABYTES,
        'tB': DataUnit.TERABYTES,
        'TB': DataUnit.TERABYTES,
        'Tb': DataUnit.TERABITS,
    };

    static isValid ( value : string | number ) {
        return value && ( typeof value === 'number' || ( typeof value === 'string' && DataAmount.pattern.test( value ) ) );
    }

    static parse ( value : string | number | DataAmount ) : DataAmount {
        if ( !value ) {
            throw new DataAmountParseError( `Value is null.` )
        }

        if ( value instanceof DataAmount ) {
            return value;
        } else if ( typeof value === 'number' ) {
            return new DataAmount( value, DataUnit.BYTES );
        } else if ( typeof value === 'string' ) {
            const match = value.match( DataAmount.pattern );

            if ( match ) {
                const unit = DataAmount.unitKeywords[ match[ 3 ] ];

                if ( !unit ) {
                    throw new DataAmountParseError( `Data value string has invalid unit: ${ match[ 3 ] }.` );
                }

                return new DataAmount( parseFloat( match[ 1 ] + ( match[ 2 ] || '' ) ), unit );
            } else {
                throw new DataAmountParseError( `Data value string has invalid format.` );
            }
        } else {
            throw new DataAmountParseError( `Value should be a DataAmount, number or string.` );
        }
    }

    static tryParse ( value : string | number | DataAmount ) : DataAmount {
        try {
            return DataAmount.parse( value );
        } catch ( error ) {
            if ( error instanceof DataAmountParseError ) {
                return null;
            }

            throw error;
        }
    }

    protected exchangeRates = [ 
        { unit: DataUnit.BITS, multiplier : 1 },
        { unit: DataUnit.BYTES, multiplier : 8 },
        { unit: DataUnit.KILOBITS, multiplier : 125 },
        { unit: DataUnit.KILOBYTES, multiplier : 8 },
        { unit: DataUnit.MEGABITS, multiplier : 125 },
        { unit: DataUnit.MEGABYTES, multiplier : 8 },
        { unit: DataUnit.GIGABITS, multiplier : 125 },
        { unit: DataUnit.GIGABYTES, multiplier : 8 },
        { unit: DataUnit.TERABITS, multiplier : 125 },
        { unit: DataUnit.TERABYTES, multiplier : 8 },
    ];

    unitToString () {
        return DataUnit[ this.unit ];
    }
}

export class DurationParseError extends Error { }

export enum DurationUnit {
    MILLISECONDS,
    SECONDS,
    MINUTES,
    HOURS,
    DAYS,
    WEEKS
}

export class Duration extends Amount<DurationUnit, Duration> {
    public static unitPattern = /(\d+)\s*(w|d|h|m|s|ms)/i;

    public static aggregatePattern = /(\d+)(:\d+){0,4}(\.\d+)?/;

    static unitKeywords = {
        'ms': DurationUnit.MILLISECONDS,
        's': DurationUnit.SECONDS,
        'm': DurationUnit.MINUTES,
        'h': DurationUnit.HOURS,
        'd': DurationUnit.DAYS,
        'w': DurationUnit.WEEKS
    };

    protected exchangeRates: { unit: DurationUnit; multiplier: number; }[] = [
        { unit: DurationUnit.MILLISECONDS, multiplier : 1 },
        { unit: DurationUnit.SECONDS, multiplier : 1000 },
        { unit: DurationUnit.MINUTES, multiplier : 60 },
        { unit: DurationUnit.HOURS, multiplier : 60 },
        { unit: DurationUnit.DAYS, multiplier : 24 },
        { unit: DurationUnit.WEEKS, multiplier : 7 },
    ];

    static isValid ( value : string | number ) {
        return value && ( typeof value === 'number' || ( typeof value === 'string' && DataAmount.pattern.test( value ) ) );
    }

    static parse ( value : string | number | Duration ) : Duration {
        if ( !value ) {
            throw new DurationParseError( `Value is null.` )
        }

        if ( value instanceof Duration ) {
            return value;
        } else if ( typeof value === 'number' ) {
            return new Duration( value, DurationUnit.SECONDS );
        } else if ( typeof value === 'string' ) {
            let match = value.match( Duration.unitPattern );

            if ( match ) {
                const value = +match[ 1 ];

                const unit = Duration.unitKeywords[ match[ 2 ].toLowerCase() ];

                return new Duration( value, unit );
            } else {
                match = value.match( Duration.aggregatePattern );

                if ( !match ) {
                    throw new DataAmountParseError( `Duration value string has invalid format.` );
                }

                const segments = value.split( ':' );

                let base = 1;

                // If the last element (seconds) contains a period, then anything after the period should be treated as milliseconds
                if ( segments[ segments.length - 1 ].indexOf( '.' ) >= 0 ) {
                    // Remove the last element (that stores seconds, segments.length - 1), and append two items
                    segments.splice( segments.length - 1, 1, ...segments[ segments.length - 1 ].split( '.' ) );

                    base = 0;
                }

                const exchangeRates = ( new Duration( 0, DurationUnit.SECONDS ) ).exchangeRates;

                const units = segments.map( ( value, index ) => {
                    const unitIndex = base + ( segments.length - index - 1 );

                    const unit = exchangeRates[ unitIndex ].unit;

                    return new Duration( +value, unit );
                } );

                return units.reduce( ( a, b ) => a.plus( b ), new Duration( 0, DurationUnit.SECONDS ) );
            }
        } else {
            throw new DurationParseError( `Value should be a Duration, number or string.` );
        }
    }

    static tryParse ( value : string | number | Duration ) : Duration {
        try {
            return Duration.parse( value );
        } catch ( error ) {
            if ( error instanceof DurationParseError ) {
                return null;
            }

            throw error;
        }
    }

    // Override
    unitToString () {
        const keys = Object.keys( Duration.unitKeywords );

        return keys.find( key => Duration.unitKeywords[ key ] === this.unit );
    }

    toHumanShortString () {
        const minutes = Math.floor( this.as( DurationUnit.MINUTES ) );

        const seconds = Math.floor( this.as( DurationUnit.SECONDS ) % 60 );

        return `${ minutes }:${ seconds }`;
    }

    toHumanString ( showMilliseconds : boolean = true ) {
        const hours = Math.floor( this.as( DurationUnit.HOURS ) );

        const minutes = Math.floor( this.as( DurationUnit.MINUTES ) );

        const seconds = Math.floor( this.as( DurationUnit.SECONDS ) % 60 );

        const milliseconds = this.as( DurationUnit.MILLISECONDS ) % 1000;

        const hoursStr = String( hours ).padStart( 2, '0' );

        const minutesStr = String( minutes ).padStart( 2, '0' );

        const secondsStr = String( seconds ).padStart( 2, '0' );

        const millisecondsStr = String( milliseconds ).padStart( 3, '0' );

        let string = `${ hoursStr }:${ minutesStr }:${ secondsStr }`;

        if ( showMilliseconds ) {
            string += `.${ millisecondsStr }`;
        }

        return string;
    }
}