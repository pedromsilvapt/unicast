import { max as maxFns, min as minFns } from 'date-fns';

export function max ( ...dates : (Date| null)[] ) : Date | null {
    dates = dates.filter( date => date != null );

    if ( dates.length === 0 ) {
        return null;
    }

    return maxFns( ...dates );
}

export function min ( ...dates : (Date| null)[] ) : Date | null {
    dates = dates.filter( date => date != null );

    if ( dates.length === 0 ) {
        return null;
    }

    return minFns( ...dates );
}