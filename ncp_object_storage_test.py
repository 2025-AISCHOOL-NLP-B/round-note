"""
NCP Object Storage 접근 테스트 스크립트 (S3 호환 API)
NCP 공식 문서: https://guide.ncloud-docs.com/docs/objectstorage-objectstorage
"""
import os
import sys
import boto3
from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError
from botocore.config import Config
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv("backend/.env")

def test_ncp_storage():
    """NCP Object Storage 연결 및 업로드 테스트"""
    
    # 환경 변수 로드
    ncp_access_key = os.getenv("NCP_ACCESS_KEY")
    ncp_secret_key = os.getenv("NCP_SECRET_KEY")
    ncp_endpoint = os.getenv("NCP_ENDPOINT_URL")
    ncp_bucket = os.getenv("NCP_BUCKET_NAME")
    
    print("=" * 70)
    print("🧪 NCP Object Storage (S3 호환) 접근 테스트")
    print("=" * 70)
    print(f"📍 Endpoint: {ncp_endpoint}")
    print(f"🪣 Bucket: {ncp_bucket}")
    print(f"🔑 Access Key: {ncp_access_key[:15]}..." if ncp_access_key else "❌ 없음")
    print(f"🔐 Secret Key: {ncp_secret_key[:15]}..." if ncp_secret_key else "❌ 없음")
    print("=" * 70)
    
    # 환경 변수 검증
    if not all([ncp_access_key, ncp_secret_key, ncp_endpoint, ncp_bucket]):
        print("❌ 필수 환경 변수가 누락되었습니다!")
        print("   - NCP_ACCESS_KEY")
        print("   - NCP_SECRET_KEY")
        print("   - NCP_ENDPOINT_URL")
        print("   - NCP_BUCKET_NAME")
        return False
    
    try:
        # S3 클라이언트 생성 (NCP S3 호환 API 설정)
        print("\n[1/5] S3 클라이언트 생성 중...")
        
        # NCP Object Storage는 특정 설정이 필요함
        config = Config(
            region_name='kr-standard',
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'standard'}
        )
        
        s3_client = boto3.client(
            's3',
            aws_access_key_id=ncp_access_key,
            aws_secret_access_key=ncp_secret_key,
            endpoint_url=ncp_endpoint,
            config=config,
            verify=True  # SSL 인증서 검증
        )
        print("✅ S3 클라이언트 생성 성공")
        
        # 버킷 목록 조회 (응답 형식 확인)
        print("\n[2/5] 버킷 목록 조회 중...")
        try:
            response = s3_client.list_buckets()
            print(f"📋 응답 구조:")
            print(f"   - Top-level Keys: {list(response.keys())}")
            
            # 원본 HTTP 응답 본체 확인
            if 'ResponseMetadata' in response:
                http_headers = response['ResponseMetadata'].get('HTTPHeaders', {})
                print(f"   - Content-Type: {http_headers.get('content-type', 'N/A')}")
                print(f"   - HTTP Status: {response['ResponseMetadata'].get('HTTPStatusCode')}")
            
            # NCP는 'Buckets' 키 대신 다른 형식 사용 가능
            if 'Buckets' in response and response['Buckets']:
                print(f"✅ 버킷 목록 조회 성공: {len(response['Buckets'])}개 버킷 발견")
                for bucket in response['Buckets']:
                    print(f"   - {bucket['Name']}")
            else:
                print(f"⚠️  'Buckets' 키가 없거나 비어있음")
                print(f"   → boto3가 XML을 파싱하지 못했습니다")
                print(f"   → 직접 XML 요청으로 버킷 목록 확인...")
                
                # boto3의 event system을 사용해서 원본 응답 확인
                def log_response(parsed, **kwargs):
                    print(f"   Raw Response Body: {parsed}")
                
                # 대신 list_objects_v2로 테스트 (버킷이 없어도 권한 확인 가능)
                print(f"   → 버킷 접근 권한 확인 중...")
        except Exception as e:
            print(f"⚠️  list_buckets 실패: {str(e)}")
        
        # 버킷 접근 가능성 확인 (HEAD bucket) - 이것이 가장 중요
        print(f"\n[3/5] 버킷 접근 테스트 중... (버킷: {ncp_bucket})")
        try:
            s3_client.head_bucket(Bucket=ncp_bucket)
            print(f"✅ 버킷 접근 성공!")
            print(f"   → 버킷이 존재하고 접근 권한이 있습니다")
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error'].get('Message', 'N/A')
            
            print(f"❌ 버킷 접근 실패")
            print(f"   - Error Code: {error_code}")
            print(f"   - Error Message: {error_message}")
            print(f"   - HTTP Status: {e.response['ResponseMetadata']['HTTPStatusCode']}")
            
            if error_code == '404' or e.response['ResponseMetadata']['HTTPStatusCode'] == 404:
                print(f"\n💡 버킷이 존재하지 않습니다: {ncp_bucket}")
                print(f"   → NCP Console에서 확인하세요:")
                print(f"   1. Object Storage → Buckets")
                print(f"   2. 버킷 이름: {ncp_bucket}")
                print(f"   3. 리전: kr-standard (Korea Central)")
            elif error_code == 'Forbidden' or error_code == 'AccessDenied':
                print(f"\n💡 IAM 권한 부족")
                print(f"   → NCP IAM 정책 확인:")
                print(f"   1. Console → Account Management → IAM")
                print(f"   2. 액세스 키 선택")
                print(f"   3. 'ObjectStorage' 권한 부여")
            
            # 계속 진행하지 않음
            return False
        
        # 테스트 파일 업로드
        print(f"\n[4/5] 테스트 파일 업로드 중...")
        test_content = b"Hello from Render! NCP Object Storage Test - " + str(os.getenv('ENVIRONMENT', 'unknown')).encode()
        test_key = "test/render_test_" + os.urandom(4).hex() + ".txt"
        
        try:
            s3_client.put_object(
                Bucket=ncp_bucket,
                Key=test_key,
                Body=test_content,
                ContentType='text/plain'
            )
            print(f"✅ 파일 업로드 성공!")
            print(f"   - Bucket: {ncp_bucket}")
            print(f"   - Key: {test_key}")
            print(f"   - Size: {len(test_content)} bytes")
        except ClientError as e:
            print(f"❌ 파일 업로드 실패")
            print(f"   - Error Code: {e.response['Error']['Code']}")
            print(f"   - Error Message: {e.response['Error'].get('Message', 'N/A')}")
            return False
        
        # 업로드된 파일 확인
        print(f"\n[5/5] 업로드된 파일 확인 중...")
        try:
            obj = s3_client.head_object(Bucket=ncp_bucket, Key=test_key)
            print(f"✅ 파일 확인 성공")
            print(f"   - Size: {obj['ContentLength']} bytes")
            print(f"   - Content-Type: {obj.get('ContentType', 'N/A')}")
            print(f"   - Last Modified: {obj['LastModified']}")
        except ClientError as e:
            print(f"❌ 파일 확인 실패: {e.response['Error']['Code']}")
            return False
        
        # 파일 다운로드 테스트
        print(f"\n[보너스] 파일 다운로드 테스트 중...")
        try:
            response = s3_client.get_object(Bucket=ncp_bucket, Key=test_key)
            downloaded_content = response['Body'].read()
            if downloaded_content == test_content:
                print(f"✅ 다운로드 및 내용 검증 성공")
            else:
                print(f"❌ 다운로드된 내용이 일치하지 않음")
                return False
        except ClientError as e:
            print(f"❌ 파일 다운로드 실패: {e.response['Error']['Code']}")
            return False
        
        # 정리: 테스트 파일 삭제
        print(f"\n[정리] 테스트 파일 삭제 중...")
        try:
            s3_client.delete_object(Bucket=ncp_bucket, Key=test_key)
            print(f"✅ 테스트 파일 삭제 완료")
        except ClientError as e:
            print(f"⚠️  파일 삭제 실패 (무시): {e.response['Error']['Code']}")
        
        print("\n" + "=" * 70)
        print("🎉 모든 테스트 통과!")
        print("✅ NCP Object Storage S3 호환 API로 접근 가능합니다!")
        print("=" * 70)
        return True
        
    except EndpointConnectionError as e:
        print("\n" + "=" * 70)
        print("❌ 엔드포인트 연결 실패")
        print("=" * 70)
        print(f"상세 에러: {str(e)}")
        print("\n💡 가능한 원인:")
        print(f"   1. 엔드포인트 URL 오류: {ncp_endpoint}")
        print("   2. 네트워크 방화벽/보안 그룹 차단")
        print("   3. DNS 해석 실패")
        print("\n✅ NCP 공식 엔드포인트: https://kr.object.ncloudstorage.com")
        return False
        
    except NoCredentialsError as e:
        print("\n" + "=" * 70)
        print("❌ 인증 정보 누락")
        print("=" * 70)
        print(f"상세 에러: {str(e)}")
        return False
        
    except Exception as e:
        print("\n" + "=" * 70)
        print(f"❌ 예상치 못한 에러 발생")
        print("=" * 70)
        print(f"에러 타입: {type(e).__name__}")
        print(f"상세 에러: {str(e)}")
        import traceback
        print(f"\n전체 스택 트레이스:")
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_ncp_storage()
    sys.exit(0 if success else 1)