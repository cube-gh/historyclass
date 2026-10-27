/* =========================================================
   Supabase 저장소 어댑터
   index.html의 LocalStore와 같은 함수들을 제공합니다.
   관리자는 Supabase Auth(이메일+비밀번호)로 로그인합니다.
   이 파일이 로드되면 index.html이 자동으로 Supabase를 사용합니다.
   ========================================================= */

// ▼▼▼ 여기 두 줄만 바꾸면 됩니다 ▼▼▼
// Supabase 대시보드 위쪽의 [Connect] 버튼, 또는 Settings > API Keys 에서 복사하세요.
// 따옴표(' ')는 지우지 말고, 그 안의 글자만 바꿔 넣으세요.
const SUPABASE_URL = 'https://pjvtzwtmfgdanjfjhehg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_OCHq4n15skLnU1HA6iTBxg_KzLLVlrE';   // sb_publishable_ 로 시작하는 키 (예전 anon 키도 됨)
// ▲▲▲ 여기까지 ▲▲▲

const BUCKET = 'pdfs';

(function () {
  // 아직 주소/키를 안 넣었으면 Supabase를 쓰지 않고 '이 브라우저 저장' 모드로 돌아갑니다
  const notSet = SUPABASE_URL.includes('YOUR-') || SUPABASE_KEY.includes('YOUR-');
  if (notSet || !window.supabase) {
    console.info('[역사교실 자료실] Supabase 주소/키가 비어 있거나 라이브러리를 못 불러와서 브라우저 저장 모드로 실행합니다.');
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL.trim().replace(/\/+$/, ''), SUPABASE_KEY.trim());

  // DB 컬럼(snake_case) → 화면에서 쓰는 형태(camelCase)
  const toMeta = r => ({
    id: r.id,
    title: r.title,
    description: r.description || '',
    category: r.category,
    tags: r.tags || [],
    size: r.size,
    fileName: r.file_name,
    filePath: r.file_path,
    downloads: r.downloads,
    createdAt: r.created_at,
  });

  const cache = new Map(); // id → file_path

  window.SupabaseStore = {
    name: 'supabase',

    async init() {},

    async list() {
      const { data, error } = await sb.from('documents').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(r => { cache.set(r.id, r.file_path); return toMeta(r); });
    },

    async add(meta, file) {
      // 1) 파일을 Storage에 올림 (한글 파일명 문제를 피하려고 경로는 랜덤 ID 사용)
      const path = `${crypto.randomUUID()}.pdf`;
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf' });
      if (up.error) throw up.error;

      // 2) 메타데이터를 documents 테이블에 저장
      const { data, error } = await sb.from('documents').insert({
        title: meta.title,
        description: meta.description,
        category: meta.category,
        tags: meta.tags,
        size: meta.size,
        file_name: meta.fileName,
        file_path: path,
      }).select().single();
      if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
      cache.set(data.id, data.file_path);
      return toMeta(data);
    },

    async getFile(id) {
      const path = cache.get(id);
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error) throw error;
      return data; // Blob
    },

    async incrementDownloads(id) {
      const { data, error } = await sb.rpc('increment_downloads', { doc_id: id });
      if (error) throw error;
      return data;
    },

    async update(id, meta, file) {
      const row = {
        title: meta.title,
        description: meta.description,
        category: meta.category,
        tags: meta.tags,
      };
      const oldPath = cache.get(id);
      let newPath = null;
      if (file) {
        newPath = `${crypto.randomUUID()}.pdf`;
        const up = await sb.storage.from(BUCKET).upload(newPath, file, { contentType: 'application/pdf' });
        if (up.error) throw up.error;
        Object.assign(row, { file_path: newPath, file_name: file.name, size: file.size });
      }
      const { data, error } = await sb.from('documents').update(row).eq('id', id).select().single();
      if (error || !data) {
        if (newPath) await sb.storage.from(BUCKET).remove([newPath]);
        throw error || new Error('수정 권한이 없습니다');
      }
      if (newPath && oldPath) await sb.storage.from(BUCKET).remove([oldPath]);
      cache.set(id, data.file_path);
      return toMeta(data);
    },

    async remove(id) {
      // 로그인한 관리자만 삭제할 수 있습니다 (README의 RLS 정책 참고)
      const path = cache.get(id);
      const { data, error } = await sb.from('documents').delete().eq('id', id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('삭제 권한이 없습니다'); // RLS가 막으면 0건 삭제됨
      await sb.storage.from(BUCKET).remove([path]);
    },

    /* --- 관리자 인증 --- */
    authMode: 'email',
    async needsSetup() { return false; },
    async login({ email, password }) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error('이메일 또는 비밀번호가 맞지 않아요.');
    },
    async isAdmin() {
      const { data } = await sb.auth.getSession();
      return !!data.session;
    },
    async logout() { await sb.auth.signOut(); },
  };
})();
