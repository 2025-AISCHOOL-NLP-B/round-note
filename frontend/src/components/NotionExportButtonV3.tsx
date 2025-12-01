/**
 * Notion 내보내기 버튼 v3
 * 멘토 피드백 반영: 참석 못한 사람을 위한 포괄적 회의록
 */

import React, { useState } from 'react';
import { Loader2, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import * as reportsService from '@/features/meetings/reportsService';

interface NotionExportButtonV3Props {
  meetingId: string;
  mode: 'action-items' | 'basic-report' | 'comprehensive-report';
  label?: string;
  showPreview?: boolean; // 미리보기 기능
}

export function NotionExportButtonV3({
  meetingId,
  mode,
  label,
  showPreview = false
}: NotionExportButtonV3Props) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);

  const getModeConfig = () => {
    switch(mode) {
      case 'comprehensive-report':
        return {
          label: label || '📝 상세 회의록 내보내기 (불참자용)',
          description: '참석 못한 사람도 완벽히 이해할 수 있는 포괄적인 회의록',
          icon: '📋',
          color: 'blue'
        };
      case 'basic-report':
        return {
          label: label || '📄 기본 회의록 내보내기',
          description: '요약과 액션 아이템 포함',
          icon: '📝',
          color: 'green'
        };
      case 'action-items':
        return {
          label: label || '⚡ 액션 아이템만 내보내기',
          description: 'Tasks 데이터베이스에 추가',
          icon: '✅',
          color: 'orange'
        };
    }
  };

  const config = getModeConfig();

  const handlePreview = async () => {
    try {
      const preview = await reportsService.previewComprehensiveReport(meetingId);
      
      toast.info('회의록 미리보기', {
        description: `
          참석자: ${preview.participants_count}명
          불참자: ${preview.absent_count}명
          논의사항: ${preview.discussions_count}개
          액션 아이템: ${preview.action_items_count}개
        `,
        duration: 5000
      });
    } catch (error: any) {
      toast.error('미리보기 로드 실패', {
        description: error.message
      });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportResult(null);

    try {
      let result;
      
      if (mode === 'comprehensive-report') {
        result = await reportsService.pushComprehensiveReportToNotion(meetingId);
      } else if (mode === 'basic-report') {
        result = await reportsService.pushReportToNotion(meetingId);
      } else {
        result = await reportsService.pushActionItemsToNotion(meetingId);
      }

      setExportResult(result);

      // 성공 토스트
      toast.success('Notion 내보내기 성공!', {
        description: result.message || '회의록이 Notion에 생성되었습니다',
        action: {
          label: 'Notion에서 보기',
          onClick: () => window.open(result.notion_url, '_blank')
        },
        duration: 10000
      });

    } catch (error: any) {
      let errorMessage = '알 수 없는 오류가 발생했습니다';
      
      if (error.response?.status === 400) {
        errorMessage = 'Notion 설정을 확인해주세요 (Integration Token, Database ID)';
      } else if (error.response?.status === 404) {
        errorMessage = '회의 데이터를 찾을 수 없습니다';
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error('Notion 내보내기 실패', {
        description: errorMessage,
        duration: 5000
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={handleExport}
          disabled={isExporting}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg
            bg-${config.color}-600 hover:bg-${config.color}-700
            text-white font-medium
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200
          `}
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>내보내는 중...</span>
            </>
          ) : (
            <>
              <span>{config.icon}</span>
              <span>{config.label}</span>
            </>
          )}
        </button>

        {showPreview && mode === 'comprehensive-report' && (
          <button
            onClick={handlePreview}
            className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm"
          >
            미리보기
          </button>
        )}
      </div>

      {/* 설명 */}
      <p className="text-xs text-gray-500">
        {config.description}
      </p>

      {/* 내보내기 결과 */}
      {exportResult && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-green-900 mb-2">
                내보내기 완료
              </h4>
              
              {mode === 'comprehensive-report' && (
                <div className="space-y-1 text-sm text-green-700">
                  <p>✅ 참석자 {exportResult.participants_count}명</p>
                  <p>❌ 불참자 {exportResult.absent_count}명</p>
                  <p>💬 논의사항 {exportResult.discussions_count}개</p>
                  <p>✅ 결정사항 {exportResult.decisions_count}개</p>
                  <p>⚡ 액션 아이템 {exportResult.action_items_count}개</p>
                  <p>❓ 미결 사항 {exportResult.pending_issues_count}개</p>
                </div>
              )}

              <a
                href={exportResult.notion_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-green-600 hover:text-green-700"
              >
                <FileText className="w-4 h-4" />
                <span>Notion에서 보기 →</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 편의 컴포넌트: 버튼 그룹
export function NotionExportButtonGroup({ meetingId }: { meetingId: string }) {
  return (
    <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
      <h3 className="font-semibold text-gray-900 mb-3">
        Notion 내보내기 옵션
      </h3>

      {/* 추천: 포괄적 회의록 */}
      <div className="border-2 border-blue-200 bg-white p-3 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
            추천
          </span>
          <span className="text-sm font-medium text-gray-700">
            참석 못한 팀원을 위한 상세 회의록
          </span>
        </div>
        <NotionExportButtonV3
          meetingId={meetingId}
          mode="comprehensive-report"
          showPreview={true}
        />
      </div>

      {/* 기본 회의록 */}
      <NotionExportButtonV3
        meetingId={meetingId}
        mode="basic-report"
      />

      {/* 액션 아이템만 */}
      <NotionExportButtonV3
        meetingId={meetingId}
        mode="action-items"
      />
    </div>
  );
}
