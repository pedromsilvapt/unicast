declare module "deep-equal" {
    interface DeepEqualOptions {
        strict: boolean;
    }
    
    function deepEqual(
        actual: any,
        expected: any,
        opts?: DeepEqualOptions): boolean;
    
    namespace deepEqual {}
    
    export = deepEqual;
}
