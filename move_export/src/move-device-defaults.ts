// ---------------------------------------------------------------------------
// Default device parameter blocks for the Move format.
// ---------------------------------------------------------------------------
//
// Lifted verbatim from move_tools/resources/Preset.ablpreset — a real Move
// drumRack/drumCell preset. Until we read each parameter off the live device,
// every exported pad gets these neutral defaults; only the sample (and trigger
// note) actually vary per pad. Each `default*()` returns a fresh object so
// callers can mutate without aliasing.

import type { MoveParameter } from "./move-format.js";

/** The 8 macro knobs every Move rack (instrumentRack / drumRack) carries. */
export function defaultRackMacros(): Record<string, MoveParameter> {
  // Real 1.8.3 Sets store every macro as a plain number (e.g. `Macro0: 0.0`),
  // not the `{value, customName}` object form some older presets used.
  return {
    Enabled: true,
    Macro0: 0.0,
    Macro1: 0.0,
    Macro2: 0.0,
    Macro3: 0.0,
    Macro4: 0.0,
    Macro5: 0.0,
    Macro6: 0.0,
    Macro7: 0.0,
  };
}

/** The full drumCell parameter set, at the reference preset's default values. */
export function defaultDrumCellParameters(): Record<string, MoveParameter> {
  return {
    Effect_EightBitFilterDecay: 5.0,
    Effect_EightBitResamplingRate: 14080.0,
    Effect_FmAmount: 0.0,
    Effect_FmFrequency: 999.9998779296876,
    Effect_LoopLength: 0.30000001192092896,
    Effect_LoopOffset: 0.019999997690320015,
    Effect_NoiseAmount: 0.0,
    Effect_NoiseFrequency: 10000.0009765625,
    Effect_On: true,
    Effect_PitchEnvelopeAmount: 0.0,
    Effect_PitchEnvelopeDecay: 0.29999998211860657,
    Effect_PunchAmount: 0.0,
    Effect_PunchTime: 0.12015999853610992,
    Effect_RingModAmount: 0.0,
    Effect_RingModFrequency: 999.9998168945313,
    Effect_StretchFactor: 1.0,
    Effect_StretchGrainSize: 0.09999999403953552,
    Effect_SubOscAmount: 0.0,
    Effect_SubOscFrequency: 59.99999237060547,
    Effect_Type: "Stretch",
    Enabled: true,
    NotePitchBend: true,
    Pan: 0.0,
    Voice_Detune: 0.0,
    Voice_Envelope_Attack: 0.00009999999747378752,
    Voice_Envelope_Decay: 1.0,
    Voice_Envelope_Hold: 0.3000001013278961,
    Voice_Envelope_Mode: "A-H-D",
    Voice_Filter_Frequency: 21999.990234375,
    Voice_Filter_On: true,
    Voice_Filter_PeakGain: 1.0,
    Voice_Filter_Resonance: 0.0,
    Voice_Filter_Type: "Lowpass",
    Voice_Gain: 1.0,
    Voice_ModulationAmount: 0.0,
    Voice_ModulationSource: "Velocity",
    Voice_ModulationTarget: "Filter",
    Voice_PitchToEnvelopeModulation: true, // present in schema 1.8.3 drumCells
    Voice_PlaybackLength: 1.0,
    Voice_PlaybackStart: 0.0,
    Voice_Transpose: 0,
    Voice_VelocityToVolume: 0.3499999940395355,
    Volume: -11.999999046325684,
  };
}

/**
 * The melodicSampler parameter set, at the reference preset's default values
 * (examples/Track Presets/melodicSampler/Ac Piano Grand.ablpreset). Maps a
 * single chromatically-played sample, like Live's Simpler.
 */
export function defaultMelodicSamplerParameters(): Record<string, MoveParameter> {
  return {
    Enabled: true,
    Voice_AmplitudeEnvelope_Attack: 0.00010000000149011613,
    Voice_AmplitudeEnvelope_Decay: 5.99999560546875,
    Voice_AmplitudeEnvelope_Release: 0.6999998779296875,
    Voice_AmplitudeEnvelope_Sustain: 0.17782793939113617,
    Voice_AmplitudeEnvelope_SustainMode: "Gate",
    Voice_Detune: 0.0,
    Voice_FilterEnvelope_Attack: 0.00010000000149011613,
    Voice_FilterEnvelope_Decay: 0.6,
    Voice_FilterEnvelope_On: false,
    Voice_FilterEnvelope_Release: 0.05,
    Voice_FilterEnvelope_Sustain: 0.0,
    Voice_Filter_Frequency: 22000.0,
    Voice_Filter_FrequencyModulationAmounts_EnvelopeAmount: 0,
    Voice_Filter_FrequencyModulationAmounts_LfoAmount: 0.0,
    Voice_Filter_On: true,
    Voice_Filter_Resonance: 0.0,
    Voice_Filter_Slope: "12",
    Voice_Filter_Type: "Lowpass",
    Voice_Gain: 1.0,
    Voice_Lfo_On: true,
    Voice_Lfo_Rate: 5.999998569488525,
    Voice_Lfo_Type: "Sine",
    Voice_PlaybackLength: 1.0,
    Voice_PlaybackStart: 0.0,
    Voice_Transpose: 0,
    Voice_VelocityToVolume: 0.3499999940395355,
    Volume: -17.0,
  };
}

// INVARIANT: a mixer's `sends` array must have exactly one entry per return
// track. We export `returnTracks: []`, so every `sends` array MUST be empty —
// otherwise Move rejects the Set with "too many sends: N, expected 0". (Real
// presets carry a send because the Set they came from had a return track.)
const NO_SENDS: MoveChainMixer["sends"] = [];

/** A drum *pad* chain's mixer block (pan / volume; no sends — see INVARIANT). */
export function defaultChainMixer(): MoveChainMixer {
  return {
    pan: 0.0,
    "solo-cue": false,
    speakerOn: true,
    volume: 0.0,
    sends: [...NO_SENDS],
  };
}

/** An instrument-rack chain's mixer block. */
export function defaultRackChainMixer(): MoveChainMixer {
  return {
    pan: 0.0,
    "solo-cue": false,
    speakerOn: true,
    volume: 0.0,
    sends: [...NO_SENDS],
  };
}

export interface MoveChainMixer {
  pan: number;
  "solo-cue": boolean;
  speakerOn: boolean;
  volume: number;
  sends: { isEnabled: boolean; amount: number }[];
}

/**
 * Default Drift synth parameters (from the Analog Shape preset), used as the
 * stock instrument for MIDI tracks with no translatable instrument. Object-form
 * params were flattened to their scalar value (macro mappings dropped) so the
 * device has no macro-mapping dependencies.
 */
export function defaultDriftParameters(): Record<string, MoveParameter> {
  return {
    CyclingEnvelope_Hold: 0.0,
    CyclingEnvelope_MidPoint: 0.5,
    CyclingEnvelope_Mode: "Freq",
    CyclingEnvelope_Rate: 4.999998569488525,
    CyclingEnvelope_Ratio: 1.0,
    CyclingEnvelope_SyncedRate: 15,
    CyclingEnvelope_Time: 1.0000001192092896,
    Enabled: true,
    Envelope1_Attack: 0.0009999996982514858,
    Envelope1_Decay: 0.6000000238418579,
    Envelope1_Release: 0.5999999642372131,
    Envelope1_Sustain: 0.699999988079071,
    Envelope2_Attack: 0.0009999996982514858,
    Envelope2_Decay: 0.6000000238418579,
    Envelope2_Release: 0.5999999642372131,
    Envelope2_Sustain: 0.0,
    Filter_Frequency: 19999.99609375,
    Filter_HiPassFrequency: 10.0,
    Filter_ModAmount1: 0.0,
    Filter_ModAmount2: 0.15000000596046448,
    Filter_ModSource1: "Env 2 / Cyc",
    Filter_ModSource2: "Pressure",
    Filter_NoiseThrough: true,
    Filter_OscillatorThrough1: true,
    Filter_OscillatorThrough2: true,
    Filter_Resonance: 0.20000000298023224,
    Filter_Tracking: 0.0,
    Filter_Type: "I",
    Global_DriftDepth: 0.07199999690055847,
    Global_Envelope2Mode: "Env",
    Global_Glide: 0.0,
    Global_HiQuality: false,
    Global_Legato: false,
    Global_MonoVoiceDepth: 0.0,
    Global_NotePitchBend: true,
    Global_PitchBendRange: 2,
    Global_PolyVoiceDepth: 0.0,
    Global_ResetOscillatorPhase: false,
    Global_SerialNumber: 2429554,
    Global_StereoVoiceDepth: 0.10000000149011612,
    Global_Transpose: 0,
    Global_UnisonVoiceDepth: 0.05000000074505806,
    Global_VoiceCount: "8",
    Global_VoiceMode: "Poly",
    Global_VolVelMod: 0.5,
    Global_Volume: 0.2818392217159271,
    Lfo_Amount: 1.0,
    Lfo_ModAmount: 0.0,
    Lfo_ModSource: "Modwheel",
    Lfo_Mode: "Freq",
    Lfo_Rate: 0.4000000059604645,
    Lfo_Ratio: 1.0,
    Lfo_Retrigger: false,
    Lfo_Shape: "Sine",
    Lfo_SyncedRate: 15,
    Lfo_Time: 1.0000001192092896,
    Mixer_NoiseLevel: 0.0,
    Mixer_NoiseOn: true,
    Mixer_OscillatorGain1: 0.9999999403953552,
    Mixer_OscillatorGain2: 0.5000000596046448,
    Mixer_OscillatorOn1: true,
    Mixer_OscillatorOn2: true,
    ModulationMatrix_Amount1: 0.800000011920929,
    ModulationMatrix_Amount2: 0.0,
    ModulationMatrix_Amount3: 0.0,
    ModulationMatrix_Source1: "Modwheel",
    ModulationMatrix_Source2: "Velocity",
    ModulationMatrix_Source3: "Pressure",
    ModulationMatrix_Target1: "HP Frequency",
    ModulationMatrix_Target2: "None",
    ModulationMatrix_Target3: "None",
    Oscillator1_Shape: 0.0,
    Oscillator1_ShapeMod: 0.0,
    Oscillator1_ShapeModSource: "Env 2 / Cyc",
    Oscillator1_Transpose: 0,
    Oscillator1_Type: "Saw",
    Oscillator2_Detune: 0.0,
    Oscillator2_Transpose: -1,
    Oscillator2_Type: "Sine",
    PitchModulation_Amount1: 0.0,
    PitchModulation_Amount2: 0.0,
    PitchModulation_Source1: "Env 2 / Cyc",
    PitchModulation_Source2: "LFO",
  };
}
