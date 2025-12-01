import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { ArrowLeft } from "lucide-react";
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { Badge } from '@/shared/ui/badge';
import {
  FileText,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  CheckCircle,
  Copy
} from 'lucide-react';
import { toast } from 'sonner';


export interface Template {
  id: string;
  name: string;
  description: string;
  sections: TemplateSection[];
  isDefault?: boolean;
}

export interface TemplateSection {
  id: string;
  title: string;
  placeholder: string;
}

interface TemplateSettingsProps {
  onBack: () => void;
}


const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'team-meeting',
    name: '팀 회의',
    description: '정기적인 팀 회의를 위한 템플릿',
    isDefault: true,
    sections: [
      { id: '1', title: '회의 일시 및 참석자', placeholder: '일시:\n참석자:\n불참자:' },
      { id: '2', title: '지난 회의 후속 조치 점검', placeholder: '- 완료된 항목:\n- 진행 중인 항목:\n- 미완료 항목:' },
      { id: '3', title: '주요 안건', placeholder: '1. 안건 1\n2. 안건 2\n3. 안건 3' },
      { id: '4', title: '논의 내용', placeholder: '각 안건별 상세 논의 내용을 기록합니다.' },
      { id: '5', title: '결정 사항', placeholder: '- 결정 1:\n- 결정 2:' },
      { id: '6', title: '액션 아이템', placeholder: '- [담당자] 업무 내용 - 마감일\n- [담당자] 업무 내용 - 마감일' },
      { id: '7', title: '다음 회의 안건', placeholder: '- 다음 회의에서 다룰 주제' },
    ],
  },
  {
    id: 'planning-meeting',
    name: '기획 회의',
    description: '프로젝트 기획 및 전략 수립을 위한 템플릿',
    isDefault: true,
    sections: [
      { id: '1', title: '프로젝트 개요', placeholder: '프로젝트명:\n목적:\n기간:' },
      { id: '2', title: '현황 분석', placeholder: '- 시장 현황:\n- 경쟁사 분석:\n- 내부 역량:' },
      { id: '3', title: '목표 설정', placeholder: '- 핵심 목표:\n- 세부 목표:\n- KPI:' },
      { id: '4', title: '전략 및 방안', placeholder: '1. 전략 1:\n   - 세부 방안\n2. 전략 2:\n   - 세부 방안' },
      { id: '5', title: '리소스 계획', placeholder: '- 인력:\n- 예산:\n- 일정:' },
      { id: '6', title: '위험 요소 및 대응 방안', placeholder: '- 위험 요소 1: 대응 방안\n- 위험 요소 2: 대응 방안' },
      { id: '7', title: '액션 아이템', placeholder: '- [담당자] 업무 내용 - 마감일' },
    ],
  },
  {
    id: 'operation-meeting',
    name: '운영 회의',
    description: '일상적인 운영 및 진행 상황 점검을 위한 템플릿',
    isDefault: true,
    sections: [
      { id: '1', title: '회의 정보', placeholder: '일시:\n참석자:\n회의 주기:' },
      { id: '2', title: '주간/월간 성과 리뷰', placeholder: '- 목표 대비 달성률:\n- 주요 성과:\n- 개선이 필요한 부분:' },
      { id: '3', title: '진행 중인 프로젝트 현황', placeholder: '프로젝트명:\n- 진행률:\n- 이슈 사항:\n- 향후 계획:' },
      { id: '4', title: '이슈 및 문제점', placeholder: '- 이슈 1: 현황 및 대응\n- 이슈 2: 현황 및 대응' },
      { id: '5', title: '개선 제안', placeholder: '- 제안 1:\n- 제안 2:' },
      { id: '6', title: '다음 주/월 계획', placeholder: '- 주요 업무 1\n- 주요 업무 2' },
      { id: '7', title: '액션 아이템', placeholder: '- [담당자] 업무 내용 - 마감일' },
    ],
  },
  {
    id: 'problem-solving-meeting',
    name: '문제 해결 회의',
    description: '특정 문제나 이슈 해결을 위한 템플릿',
    isDefault: true,
    sections: [
      { id: '1', title: '문제 정의', placeholder: '문제 요약:\n발생 시점:\n영향 범위:' },
      { id: '2', title: '현황 분석', placeholder: '- 현재 상태:\n- 데이터 및 증거:\n- 이해관계자:' },
      { id: '3', title: '원인 분석', placeholder: '- 근본 원인:\n- 기여 요인:\n- 분석 방법:' },
      { id: '4', title: '해결 방안 제시', placeholder: '방안 1:\n - 장점:\n - 단점:\n - 필요 리소스:\n\n방안 2:\n - 장점:\n - 단점:\n - 필요 리소스:' },
      { id: '5', title: '최종 결정', placeholder: '선택한 해결 방안:\n이유:\n기대 효과:' },
      { id: '6', title: '실행 계획', placeholder: '단계:\n일정:\n담당자:\n체크포인트:' },
      { id: '7', title: '액션 아이템', placeholder: '- [담당자] 업무 내용 - 마감일' },
    ],
  },
  {
    id: 'decision-meeting',
    name: '결정 회의',
    description: '중요한 의사결정을 위한 템플릿',
    isDefault: true,
    sections: [
      { id: '1', title: '결정 안건', placeholder: '안건:\n배경:\n중요도:' },
      { id: '2', title: '옵션 및 대안', placeholder: '옵션 1:\n - 장점:\n - 단점:\n - 비용:\n\n옵션 2:\n - 장점:\n - 단점:\n - 비용:' },
      { id: '3', title: '평가 기준', placeholder: '- 기준 1: 비중\n- 기준 2: 비중\n- 기준 3: 비중' },
      { id: '4', title: '각 옵션 평가', placeholder: '옵션별 기준 평가 점수 및 총점' },
      { id: '5', title: '의견 및 토론', placeholder: '찬성 의견:\n반대 의견:\n중립/대안 의견:' },
      { id: '6', title: '최종 결정', placeholder: '결정 내용:\n결정 이유:\n시행 시기:' },
      { id: '7', title: '후속 조치', placeholder: '- 조치 1: 담당자, 기한\n- 조치 2: 담당자, 기한' },
    ],
  },
];

const STORAGE_KEY = 'meeting-templates';

export function TemplateSettings({ onBack }: TemplateSettingsProps) {
  const [templates, setTemplates] = useState<Template[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        // Merge with default templates (in case new defaults were added)
        const customTemplates = data.filter((t: Template) => !t.isDefault);
        return [...DEFAULT_TEMPLATES, ...customTemplates];
      } catch {
        return DEFAULT_TEMPLATES;
      }
    }
    return DEFAULT_TEMPLATES;
  });


  const [selectedTemplate, setSelectedTemplate] = useState<Template>(templates[0]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTemplate, setEditedTemplate] = useState<Template>(templates[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(() => {
    return localStorage.getItem('active-template-id');
  });

  const saveTemplates = (newTemplates: Template[]) => {
    const customTemplates = newTemplates.filter(t => !t.isDefault);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customTemplates));
    setTemplates(newTemplates);
  };

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setEditedTemplate(template);
    setIsEditing(false);
    setIsCreating(false);
  };

  const handleSetActiveTemplate = (templateId: string) => {
    setActiveTemplateId(templateId);
    localStorage.setItem('active-template-id', templateId);
    toast.success('템플릿이 지정되었습니다. 다음 회의부터 이 템플릿이 적용됩니다.');
  };

  const handleCreateNew = () => {
    const newTemplate: Template = {
      id: `custom-${Date.now()}`,
      name: '새 템플릿',
      description: '템플릿 설명을 입력하세요',
      sections: [
        { id: '1', title: '섹션 1', placeholder: '내용을 입력하세요' },
      ],
    };
    setEditedTemplate(newTemplate);
    setSelectedTemplate(newTemplate);
    setIsCreating(true);
    setIsEditing(true);
  };

  const handleSaveTemplate = () => {
    if (isCreating) {
      const newTemplates = [...templates, editedTemplate];
      saveTemplates(newTemplates);
      setIsCreating(false);
      toast.success('새 템플릿이 생성되었습니다.');
    } else {
      const newTemplates = templates.map(t =>
        t.id === editedTemplate.id ? editedTemplate : t
      );
      saveTemplates(newTemplates);
      setSelectedTemplate(editedTemplate);
      toast.success('템플릿이 수정되었습니다.');
    }
    setIsEditing(false);
  };

  const handleDeleteTemplate = () => {
    if (selectedTemplate.isDefault) {
      toast.error('기본 템플릿은 삭제할 수 없습니다.');
      return;
    }

    if (confirm('정말로 이 템플릿을 삭제하시겠습니까?')) {
      const newTemplates = templates.filter(t => t.id !== selectedTemplate.id);
      saveTemplates(newTemplates);
      setSelectedTemplate(templates[0]);
      setEditedTemplate(templates[0]);
      setIsEditing(false);
      toast.success('템플릿이 삭제되었습니다.');
    }
  };

  const handleAddSection = () => {
    const newSection: TemplateSection = {
      id: Date.now().toString(),
      title: '새 섹션',
      placeholder: '내용을 입력하세요',
    };
    setEditedTemplate({
      ...editedTemplate,
      sections: [...editedTemplate.sections, newSection],
    });
  };

  const handleUpdateSection = (sectionId: string, field: keyof TemplateSection, value: string) => {
    setEditedTemplate({
      ...editedTemplate,
      sections: editedTemplate.sections.map(s =>
        s.id === sectionId ? { ...s, [field]: value } : s
      ),
    });
  };

  const handleDeleteSection = (sectionId: string) => {
    if (editedTemplate.sections.length <= 1) {
      toast.error('최소 1개의 섹션이 필요합니다.');
      return;
    }
    setEditedTemplate({
      ...editedTemplate,
      sections: editedTemplate.sections.filter(s => s.id !== sectionId),
    });
  };

  const handleDuplicateTemplate = () => {
    const duplicatedTemplate: Template = {
      ...selectedTemplate,
      id: `custom-${Date.now()}`,
      name: `${selectedTemplate.name} (복사본)`,
      isDefault: false,
    };
    const newTemplates = [...templates, duplicatedTemplate];
    saveTemplates(newTemplates);
    setSelectedTemplate(duplicatedTemplate);
    setEditedTemplate(duplicatedTemplate);
    toast.success('템플릿이 복제되었습니다.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            onClick={onBack}
            variant="ghost"
            size="icon"
            className="hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-primary">템플릿 보기</h2>
            <p className="text-sm text-muted-foreground mt-1">
              템플릿 지정 및 수정, 삭제가 가능합니다
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* 왼쪽: 템플릿 리스트 */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>템플릿 목록</span>
              <Button size="sm" onClick={handleCreateNew} className="gap-1">
                <Plus className="w-4 h-4" />
                새 템플릿
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {templates.map((template) => (
                <div
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedTemplate.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                      <h4 className="font-medium text-sm">{template.name}</h4>
                    </div>
                    {activeTemplateId === template.id && (
                      <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">{template.description}</p>
                  {template.isDefault && (
                    <Badge variant="secondary" className="text-xs mt-2 ml-6">기본</Badge>
                  )}
                </div>
              ))}
            </div>

            {/* 템플릿 지정 버튼 */}
            {selectedTemplate && (
              <Button
                onClick={() => handleSetActiveTemplate(selectedTemplate.id)}
                className="w-full mt-4 gap-2"
                variant={activeTemplateId === selectedTemplate.id ? "secondary" : "default"}
              >
                {activeTemplateId === selectedTemplate.id ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    적용 중인 템플릿
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    이 템플릿 지정
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* 오른쪽: 템플릿 상세 */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">템플릿 상세</CardTitle>
              <div className="flex gap-2">
                {!isEditing ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDuplicateTemplate}
                      className="gap-1"
                    >
                      <Copy className="w-4 h-4" />
                      복제
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                      className="gap-1"
                      disabled={selectedTemplate.isDefault}
                    >
                      <Edit3 className="w-4 h-4" />
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDeleteTemplate}
                      className="gap-1"
                      disabled={selectedTemplate.isDefault}
                    >
                      <Trash2 className="w-4 h-4" />
                      삭제
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setIsCreating(false);
                        setEditedTemplate(selectedTemplate);
                      }}
                      className="gap-1"
                    >
                      <X className="w-4 h-4" />
                      취소
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveTemplate}
                      className="gap-1"
                    >
                      <Check className="w-4 h-4" />
                      저장
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {/* 템플릿 기본 정보 */}
              <div className="space-y-3 pb-4 border-b">
                <div className="space-y-2">
                  <label className="text-sm font-medium">템플릿 이름</label>
                  <Input
                    value={isEditing ? editedTemplate.name : selectedTemplate.name}
                    onChange={(e) => setEditedTemplate({ ...editedTemplate, name: e.target.value })}
                    disabled={!isEditing}
                    className={!isEditing ? 'bg-slate-50' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">설명</label>
                  <Textarea
                    value={isEditing ? editedTemplate.description : selectedTemplate.description}
                    onChange={(e) => setEditedTemplate({ ...editedTemplate, description: e.target.value })}
                    disabled={!isEditing}
                    className={!isEditing ? 'bg-slate-50' : ''}
                    rows={2}
                  />
                </div>
              </div>

              {/* 섹션들 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">템플릿 섹션</h4>
                  {isEditing && (
                    <Button size="sm" variant="outline" onClick={handleAddSection} className="gap-1">
                      <Plus className="w-4 h-4" />
                      섹션 추가
                    </Button>
                  )}
                </div>

                {(isEditing ? editedTemplate : selectedTemplate).sections.map((section, index) => (
                  <Card key={section.id} className="border-slate-200">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{index + 1}</Badge>
                          {isEditing ? (
                            <Input
                              value={section.title}
                              onChange={(e) => handleUpdateSection(section.id, 'title', e.target.value)}
                              className="h-8"
                              placeholder="섹션 제목"
                            />
                          ) : (
                            <h5 className="font-medium">{section.title}</h5>
                          )}
                        </div>
                        {isEditing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteSection(section.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={section.placeholder}
                        onChange={(e) => handleUpdateSection(section.id, 'placeholder', e.target.value)}
                        disabled={!isEditing}
                        className={!isEditing ? 'bg-slate-50' : ''}
                        rows={4}
                        placeholder="섹션 내용 또는 가이드"
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
