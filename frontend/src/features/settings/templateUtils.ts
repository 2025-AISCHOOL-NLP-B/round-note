// Template utility functions for applying templates to meeting summaries

import type { Template, TemplateSection } from '@/features/settings/TemplateSettings';

/**
 * Get the active template from localStorage
 */
export function getActiveTemplate(): Template | null {
    try {
        const activeTemplateId = localStorage.getItem('active-template-id');
        if (!activeTemplateId) return null;

        const stored = localStorage.getItem('meeting-templates');
        if (!stored) return null;

        const templates: Template[] = JSON.parse(stored);
        return templates.find(t => t.id === activeTemplateId) || null;
    } catch (error) {
        console.error('Failed to get active template:', error);
        return null;
    }
}

/**
 * Apply template structure to a meeting summary
 */
export function applyTemplateToSummary(summary: string, template: Template): { [sectionTitle: string]: string } {
    const result: { [sectionTitle: string]: string } = {};

    if (!summary || !summary.trim()) {
        template.sections.forEach((section: TemplateSection) => {
            result[section.title] = section.placeholder;
        });
        return result;
    }

    template.sections.forEach((section: TemplateSection, index: number) => {
        if (index === 0) {
            result[section.title] = summary;
        } else {
            result[section.title] = section.placeholder;
        }
    });

    return result;
}