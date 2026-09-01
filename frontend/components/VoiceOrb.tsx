"use client";

import { useState, useCallback, useRef } from "react";

interface VoiceOrbProps {
  onVoiceMessage?: (text: string) => void;
  isActive?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function VoiceOrb({ onVoiceMessage, isActive }: VoiceOrbProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
            ? "audio/ogg;codecs=opus"
            : "";

      if (!mimeType) {
        alert("Audio recording is not supported in this browser.");
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });

        setIsProcessing(true);
        setIsRecording(false);

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");

          const response = await fetch(`${API_BASE}/api/speech-to-text`, {
            method: "POST",
            body: formData,
          });


          if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
          }

          const result = await response.json();
          
          const text = (result.text || "").trim();
          
          if (onVoiceMessage) {
            onVoiceMessage(text);
          } else {
          }
        } catch (error) {
          console.error("Speech recognition failed:", error);
          alert(`Speech recognition failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
          setIsProcessing(false);
        }

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      if ((error as DOMException).name === "NotAllowedError") {
        alert("Microphone access denied. Please allow microphone access in your browser settings.");
      }
    }
  }, [onVoiceMessage]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 py-4 px-4">
      <div
        className={`
          relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer
          transition-all duration-300 ease-in-out
          ${isProcessing
            ? "bg-gradient-to-br from-amber-400 to-yellow-500 shadow-lg shadow-amber-200 scale-105"
            : isRecording
              ? "bg-gradient-to-br from-red-400 to-rose-500 shadow-lg shadow-red-200 scale-110"
              : "bg-gradient-to-br from-indigo-400 to-purple-500 shadow-lg shadow-indigo-200 hover:shadow-xl hover:scale-105"
          }
        `}
        onClick={isRecording ? stopRecording : startRecording}
        title={
          isProcessing
            ? "Processing..."
            : isRecording
              ? "Tap to stop recording"
              : "Tap to speak"
        }
      >
        {/* Pulse rings */}
        {isRecording && (
          <>
            <div className="absolute inset-0 rounded-full bg-red-400/30 animate-ping" />
            <div className="absolute -inset-2 rounded-full border-2 border-red-300/50 animate-pulse" />
          </>
        )}

        {/* Spinner for processing */}
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Icon */}
        <svg
          className={`w-8 h-8 text-white relative z-10 ${isProcessing ? "opacity-0" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {isRecording ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z
                 M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z
                 M19 10v2a7 7 0 01-14 0v-2M12 19a4 4 0 004 4h0a4 4 0 00-4-4h0z"
            />
          )}
        </svg>
      </div>

      <p className="text-xs text-gray-400">
        {isProcessing
          ? "Processing..."
          : isRecording
            ? "Tap to stop"
            : "Tap to speak"}
      </p>
    </div>
  );
}
