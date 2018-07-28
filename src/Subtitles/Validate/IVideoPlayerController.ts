export interface IVideoPlayerController<R = void> {
    play ( video : string, subtitles : string ) : Promise<R>;
}