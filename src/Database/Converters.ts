export type FieldConverters<A, B> = {
    [ K in keyof (A | B) ]: Converter<A[K], B[K]>
}

export interface Converter<A, B>  {
    serialize ( value : A ) : B;
    deserialize ( value : B ) : A;
}

export class Converters {
    public static self<T> () : Converter<T, T> {
        return {
            serialize: ( value ) => value,
            deserialize: ( value ) => value,
        };
    }
    
    public static id () : Converter<string, number> {
        return {
            serialize: ( value ) => typeof value == 'string' ? +value : value,
            deserialize: ( value ) => typeof value == 'number' ? '' + value : value,
        };
    }
    
    public static bool () : Converter<boolean, number> {
        return {
            serialize: ( value ) => typeof value == 'boolean' ? +value : value,
            deserialize: ( value ) => typeof value == 'number' ? !!value : value,
        };
    }
    
    public static json<T = any> () : Converter<T, string> {
        return {
            serialize: ( value ) => value != null ? JSON.stringify( value ) : null,
            deserialize: ( value ) => value != null ? JSON.parse( value ) : null,
        };
    }
    
    public static date () : Converter<Date, number> {
        return {
            serialize: ( value ) => {
                if ( value instanceof Date ) {
                   return value.getTime(); 
                } else if ( typeof value == 'string' ) {
                    return new Date( value ).getTime(); 
                } else {
                    return value;
                }
            },
            deserialize: ( value ) => typeof value == 'number' || typeof value == 'string' ? new Date( value ) : value,
        };
    }
}
