"use client";

import React from 'react';
// import logo from '../logo.svg';

import useHealthCheck from '@/hooks/useHealthCheck';
import useRealtimeStream from '@/hooks/useRealtimeStream';

function VADTestPage() {
    // 1. Health Check 훅 사용
    const { healthCheckData, loading, error, apiUrl } = useHealthCheck();

    // 2. Realtime Stream 훅 사용 (핵심 통신 및 상태)
    const {
        isRecording,
        transcript,
        partialText,
        translation,
        startRecording,
        stopRecording,
    } = useRealtimeStream();

    // 3. Health Check 렌더링 함수
    const renderHealthCheck = () => {
        // App.js에서 가져온 헬스 체크 렌더링 로직
        if (loading) {
            return <p>Loading Health Check from {apiUrl}...</p>;
        }
        if (error) {
            return <p style={{ color: 'red' }}>Error: {error}</p>;
        }
        if (healthCheckData) {
            return <pre>{JSON.stringify(healthCheckData, null, 2)}</pre>;
        }
        return null;
    };

    return (
        <header className="App-header">
            {/* <img src={logo} className="App-logo" alt="logo" /> */}
            <h1>Round Note - Sprint 0 & 1 Test</h1>

            {/* 헬스 체크 섹션 */}
            <div style={{ marginBottom: '30px', padding: '10px', border: '1px solid #61dafb', borderRadius: '8px', maxWidth: '600px', width: '90%' }}>
                <h2>API Health Check Result:</h2>
                {renderHealthCheck()}
            </div>

            {/* 실시간 스트리밍 섹션 (실제 UI) */}
            <div style={{ width: '90%', maxWidth: '900px', textAlign: 'left', backgroundColor: '#3c4049', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)' }}>
                <h2>🎙️ 실시간 회의 스트리밍</h2>

                {/* 컨트롤 버튼 */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={loading}
                        style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: isRecording ? '#dc3545' : '#28a745', color: 'white', border: 'none', borderRadius: '5px' }}
                    >
                        {isRecording ? '⏹️ 녹음 중지' : '🎙️ 녹음 시작'}
                    </button>
                </div>

                <p style={{ color: isRecording ? '#28a745' : '#6c757d', fontWeight: 'bold' }}>
                    상태: {isRecording ? '🔴 녹음 중' : '⚪ 대기 중'}
                </p>

                {/* 전사 결과 창 */}
                <div style={{ backgroundColor: '#1e1e1e', padding: '15px', borderRadius: '8px', minHeight: '150px', maxHeight: '300px', overflowY: 'auto', marginBottom: '15px', whiteSpace: 'pre-wrap', fontSize: '14px' }}>
                    <h3 style={{ marginTop: 0, color: '#f8f9fa' }}>전사 결과 (Final Transcript)</h3>
                    {transcript.map((segment) => (
                        <div key={segment.id} style={{ marginBottom: '10px' }}>
                            <span style={{ color: '#61dafb', fontWeight: 'bold' }}>{segment.speaker}</span>
                            <span style={{ color: '#adb5bd' }}> [{segment.timestamp}]: </span>
                            <span style={{ color: '#f8f9fa' }}>{segment.text}</span>
                        </div>
                    ))}
                </div>

                {/* 부분 전사 및 번역 창 */}
                <div style={{ borderTop: '1px dashed #6c757d', paddingTop: '10px' }}>
                    {partialText && (
                        <p style={{ color: '#ffc107', fontStyle: 'italic' }}>
                            💭 {partialText}
                        </p>
                    )}
                    {translation && (
                        <p style={{ color: '#61dafb', borderLeft: '3px solid #61dafb', paddingLeft: '10px' }}>
                            **[번역]** {translation}
                        </p>
                    )}
                </div>
            </div>
        </header>
    );
}

export default VADTestPage;