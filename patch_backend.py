import os

def patch_service():
    file_path = r'backend/core/llm/service.py'
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'generate_meeting_metadata' in content:
        print('generate_meeting_metadata already exists in service.py')
        return

    # Find the end of LLMService class or append to end of file if it's the only class
    # Actually, we can just append it to the end of the class.
    # Let's find the last method 'get_summary_and_actions' and append after it.
    
    target_str = '            return {\n                "rolling_summary": previous_summary or "[요약 생성 실패]",\n                "action_items": []\n            }'
    
    new_method = '''

    async def generate_meeting_metadata(self, content: str) -> dict:
        """
        회의 내용을 기반으로 제목과 목적을 자동 생성
        
        Args:
            content: 회의 전사 텍스트
            
        Returns:
            dict: {
                "title": "자동 생성된 제목",
                "purpose": "자동 생성된 목적"
            }
        """
        if not content or not content.strip():
            return {
                "title": "",
                "purpose": ""
            }
        
        try:
            chat_completion = await self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": """You are an expert meeting analyst. Analyze the meeting transcript and extract:
1. A concise meeting title (5-10 words)
2. The meeting purpose/objective (1-2 sentences)

Return ONLY a JSON object with this exact format:
{
    "title": "회의 제목",
    "purpose": "회의 목적"
}

Rules:
- Title should be professional and capture the main topic
- Purpose should be a clear, concise summary of why the meeting was held
- Both should be in Korean
- Do NOT include timestamps or speaker names
- Focus on the actual content and key discussion points"""
                    },
                    {
                        "role": "user",
                        "content": f"다음 회의 전사 내용을 분석하여 제목과 목적을 생성해주세요:\\n\\n{content[:3000]}"
                    }
                ],
                model="gpt-4o-mini",
                temperature=0.3,
                max_tokens=300,
                response_format={"type": "json_object"}
            )
            
            result_text = chat_completion.choices[0].message.content.strip()
            result = json.loads(result_text)
            
            return {
                "title": result.get("title", "").strip(),
                "purpose": result.get("purpose", "").strip()
            }
            
        except Exception as e:
            print(f"LLM generate_meeting_metadata Error: {e}")
            return {
                "title": "",
                "purpose": ""
            }
'''
    
    if target_str in content:
        new_content = content.replace(target_str, target_str + new_method)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print('Successfully patched service.py')
    else:
        print('Could not find target string in service.py')
        # Fallback: try to find without indentation or with different indentation
        # But for now, let's just print the error.

def patch_endpoints():
    file_path = r'backend/api/v1/reports/endpoints.py'
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'class RegenerateRequest' in content:
        print('RegenerateRequest already exists in endpoints.py')
    else:
        # Add RegenerateRequest class
        target_import = '@router.post("/{meeting_id}/regenerate")'
        replacement_import = 'class RegenerateRequest(BaseModel):\n    content: str = None\n\n@router.post("/{meeting_id}/regenerate")'
        content = content.replace(target_import, replacement_import)
        
        # Update function signature
        target_sig = 'async def regenerate_summary(\n    meeting_id: str,\n    db: Session = Depends(get_db)\n):'
        replacement_sig = 'async def regenerate_summary(\n    meeting_id: str,\n    request: RegenerateRequest = None,\n    db: Session = Depends(get_db)\n):'
        content = content.replace(target_sig, replacement_sig)

        # Update content check
        target_check = '    # 전사 텍스트 확인\n    if not meeting.CONTENT:'
        replacement_check = '    # 전사 텍스트 확인\n    content = request.content if request and request.content else meeting.CONTENT\n    if not content:'
        content = content.replace(target_check, replacement_check)

        # Update transcript_texts
        target_texts = 'transcript_texts = [meeting.CONTENT]'
        replacement_texts = 'transcript_texts = [content]'
        content = content.replace(target_texts, replacement_texts)

        # Add metadata generation
        target_llm = 'result = await llm_service.get_summary_and_actions(transcript_texts)'
        replacement_llm = 'result = await llm_service.get_summary_and_actions(transcript_texts)\n        \n        # 제목과 목적 자동 생성\n        metadata = await llm_service.generate_meeting_metadata(content)'
        content = content.replace(target_llm, replacement_llm)

        # Update return dict
        target_return = '"action_items_count": len(result["action_items"])\n        }'
        replacement_return = '"action_items_count": len(result["action_items"]),\n            "title": metadata.get("title", ""),\n            "purpose": metadata.get("purpose", "")\n        }'
        content = content.replace(target_return, replacement_return)

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('Successfully patched endpoints.py')

if __name__ == '__main__':
    try:
        patch_service()
        patch_endpoints()
    except Exception as e:
        print(f"Error: {e}")
