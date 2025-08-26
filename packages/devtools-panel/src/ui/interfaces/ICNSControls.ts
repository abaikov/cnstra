export interface ICNSControls {
    isPlaying: boolean;
    speed: number;
    onPlayPause: () => void;
    onSpeedChange: (speed: number) => void;
}
