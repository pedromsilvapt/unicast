import { UnicastServer } from "../UnicastServer";

export abstract class DriverFactory<D> {
    readonly type : string;

    readonly name : string;

    constructor ( type : string, name : string ) {
        this.type = type;
        this.name = name;
    }
    
    abstract create ( server : UnicastServer ) : D;
}
