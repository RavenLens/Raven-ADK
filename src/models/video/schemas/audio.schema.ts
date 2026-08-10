export interface SpeechWordAlignment {
    text: string;
    startMs: number;
    endMs: number;
}

export interface SpeechPhonemeAlignment {
    value: string;
    startMs: number;
    endMs: number;
}

export interface SpeechVisemeAlignment {
    value: string;
    startMs: number;
    endMs: number;
}

export interface SpeechAlignment {
    words?: SpeechWordAlignment[];
    phonemes?: SpeechPhonemeAlignment[];
    visemes?: SpeechVisemeAlignment[];
}
