import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function exportMeetingToNotion(meeting: any) {
  if (!meeting) {
    toast.error('내보낼 회의 정보가 없습니다.');
    return;
  }

  const payload = {
    overallSummary: meeting.summary || '',
    meetingInfo: {
      title: meeting.title,
      date: meeting.date,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
      participants: meeting.participants || [],
    },
    meetingSummary: meeting.summary || '',
    actionItems: meeting.actionItems || [],
    fullTranscript: meeting.content || ''
  };

  try {
    const res = await fetch(`${API_URL}/api/v1/reports/${meeting.id}/report/to-notion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // httpOnly Cookie 전송
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // if backend doesn't have endpoint yet, show fallback
      toast.error('Notion 연동을 수행할 수 없습니다. 백엔드가 준비되지 않았습니다.');
      // fallback: download JSON
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notion_export_${meeting.title || meeting.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    toast.success('Notion으로 리포트 전송 요청이 전송되었습니다.');
  } catch (error) {
    console.error('Notion export failed', error);
    toast.error('Notion 연동 중 오류가 발생했습니다.');
  }
}
