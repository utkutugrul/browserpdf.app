#!/usr/bin/env python3
"""Apply the idempotent Phase 6 Document Doctor copy migration to all locales."""

import argparse
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "public" / "translations.json"

# Heading, intro, quick, deep, diagnose, normalize, rebuild, open CTA.
CORE = {
 "es": ("Comprobar la estructura y la representación del PDF", "Compara analizadores estrictos y tolerantes y revisa señales estructurales limitadas sin subir el PDF.", "Comprobación estructural rápida", "Comprobación profunda de páginas", "Diagnosticar el PDF seleccionado", "Normalizar la estructura del PDF", "Reconstruir el contenido de las páginas", "Abrir Document Doctor"),
 "fr": ("Vérifier la structure et le rendu du PDF", "Comparez les analyseurs strict et tolérant et inspectez des signaux structurels bornés sans téléverser le PDF.", "Vérification structurelle rapide", "Vérification approfondie des pages", "Diagnostiquer le PDF sélectionné", "Normaliser la structure du PDF", "Reconstruire le contenu des pages", "Ouvrir Document Doctor"),
 "de": ("PDF-Struktur und Darstellung prüfen", "Vergleichen Sie strikte und tolerante Parser und prüfen Sie begrenzte Struktursignale, ohne die PDF hochzuladen.", "Schnelle Strukturprüfung", "Tiefe Seitenprüfung", "Ausgewählte PDF diagnostizieren", "PDF-Struktur normalisieren", "Seiteninhalt neu aufbauen", "Document Doctor öffnen"),
 "pt": ("Verificar estrutura e renderização do PDF", "Compare analisadores estritos e tolerantes e inspecione sinais estruturais limitados sem enviar o PDF.", "Verificação estrutural rápida", "Verificação profunda de páginas", "Diagnosticar PDF selecionado", "Normalizar estrutura do PDF", "Reconstruir conteúdo das páginas", "Abrir Document Doctor"),
 "ru": ("Проверить структуру и отображение PDF", "Сравните строгий и терпимый анализ и проверьте ограниченные структурные сигналы без загрузки PDF.", "Быстрая проверка структуры", "Глубокая проверка страниц", "Диагностировать выбранный PDF", "Нормализовать структуру PDF", "Пересобрать содержимое страниц", "Открыть Document Doctor"),
 "ja": ("PDF の構造と表示を確認", "PDF をアップロードせず、厳密解析と寛容解析を比較して限定的な構造シグナルを調べます。", "クイック構造チェック", "ページの詳細チェック", "選択した PDF を診断", "PDF 構造を正規化", "ページ内容を再構築", "Document Doctor を開く"),
 "ko": ("PDF 구조 및 렌더링 확인", "PDF를 업로드하지 않고 엄격한 파서와 허용적 파서를 비교하고 제한된 구조 신호를 검사합니다.", "빠른 구조 확인", "심층 페이지 확인", "선택한 PDF 진단", "PDF 구조 정규화", "페이지 콘텐츠 재구성", "Document Doctor 열기"),
 "zh": ("检查 PDF 结构和渲染", "无需上传 PDF，即可比较严格和宽容解析器并检查有限的结构信号。", "快速结构检查", "深度页面检查", "诊断所选 PDF", "规范化 PDF 结构", "重建页面内容", "打开 Document Doctor"),
 "zh-TW": ("檢查 PDF 結構與呈現", "無需上傳 PDF，即可比較嚴格與寬容解析器並檢查有限的結構訊號。", "快速結構檢查", "深度頁面檢查", "診斷所選 PDF", "正規化 PDF 結構", "重建頁面內容", "開啟 Document Doctor"),
 "ar": ("فحص بنية PDF وعرضه", "قارن بين التحليل الصارم والمتسامح وافحص إشارات بنيوية محدودة دون رفع ملف PDF.", "فحص بنيوي سريع", "فحص عميق للصفحات", "تشخيص ملف PDF المحدد", "تسوية بنية PDF", "إعادة بناء محتوى الصفحات", "فتح Document Doctor"),
 "th": ("ตรวจสอบโครงสร้างและการแสดงผล PDF", "เปรียบเทียบตัวแยกวิเคราะห์แบบเข้มงวดและยืดหยุ่น พร้อมตรวจสอบสัญญาณโครงสร้างแบบจำกัดโดยไม่อัปโหลด PDF", "ตรวจโครงสร้างแบบรวดเร็ว", "ตรวจหน้าแบบละเอียด", "วินิจฉัย PDF ที่เลือก", "ปรับโครงสร้าง PDF ให้เป็นมาตรฐาน", "สร้างเนื้อหาหน้าใหม่", "เปิด Document Doctor"),
 "uk": ("Перевірити структуру й відображення PDF", "Порівняйте строгий і толерантний аналіз та перевірте обмежені структурні сигнали без завантаження PDF.", "Швидка перевірка структури", "Глибока перевірка сторінок", "Діагностувати вибраний PDF", "Нормалізувати структуру PDF", "Перебудувати вміст сторінок", "Відкрити Document Doctor"),
 "cs": ("Zkontrolovat strukturu a vykreslení PDF", "Porovnejte striktní a tolerantní analýzu a zkontrolujte omezené strukturální signály bez nahrání PDF.", "Rychlá kontrola struktury", "Hloubková kontrola stránek", "Diagnostikovat vybraný PDF", "Normalizovat strukturu PDF", "Znovu sestavit obsah stránek", "Otevřít Document Doctor"),
 "tr": ("PDF yapısını ve görüntülemeyi denetleyin", "PDF'yi yüklemeden katı ve toleranslı ayrıştırıcıları karşılaştırın ve sınırlı yapısal sinyalleri inceleyin.", "Hızlı yapı denetimi", "Derin sayfa denetimi", "Seçili PDF'yi tanıla", "PDF yapısını normalleştir", "Sayfa içeriğini yeniden oluştur", "Document Doctor'ı aç"),
 "nl": ("PDF-structuur en weergave controleren", "Vergelijk strikte en tolerante parsers en inspecteer begrensde structuursignalen zonder de PDF te uploaden.", "Snelle structuurcontrole", "Diepe paginacontrole", "Geselecteerde PDF diagnosticeren", "PDF-structuur normaliseren", "Pagina-inhoud opnieuw opbouwen", "Document Doctor openen"),
 "pl": ("Sprawdź strukturę i renderowanie PDF", "Porównaj parser ścisły i tolerancyjny oraz sprawdź ograniczone sygnały strukturalne bez przesyłania PDF.", "Szybka kontrola struktury", "Głęboka kontrola stron", "Diagnozuj wybrany PDF", "Normalizuj strukturę PDF", "Przebuduj zawartość stron", "Otwórz Document Doctor"),
 "it": ("Controlla struttura e rendering del PDF", "Confronta parser rigorosi e tolleranti e ispeziona segnali strutturali limitati senza caricare il PDF.", "Controllo strutturale rapido", "Controllo approfondito delle pagine", "Diagnostica il PDF selezionato", "Normalizza la struttura PDF", "Ricostruisci il contenuto delle pagine", "Apri Document Doctor"),
 "vi": ("Kiểm tra cấu trúc và hiển thị PDF", "So sánh trình phân tích nghiêm ngặt và dung sai, đồng thời kiểm tra các tín hiệu cấu trúc có giới hạn mà không tải PDF lên.", "Kiểm tra cấu trúc nhanh", "Kiểm tra sâu từng trang", "Chẩn đoán PDF đã chọn", "Chuẩn hóa cấu trúc PDF", "Tạo lại nội dung trang", "Mở Document Doctor"),
 "id": ("Periksa struktur dan perenderan PDF", "Bandingkan parser ketat dan toleran serta periksa sinyal struktur terbatas tanpa mengunggah PDF.", "Pemeriksaan struktur cepat", "Pemeriksaan halaman mendalam", "Diagnosis PDF terpilih", "Normalkan struktur PDF", "Bangun ulang konten halaman", "Buka Document Doctor"),
 "sv": ("Kontrollera PDF-struktur och rendering", "Jämför strikt och tolerant parsning och granska begränsade struktursignaler utan att ladda upp PDF-filen.", "Snabb strukturkontroll", "Djup sidkontroll", "Diagnostisera vald PDF", "Normalisera PDF-struktur", "Bygg om sidinnehåll", "Öppna Document Doctor"),
 "hi": ("PDF संरचना और रेंडरिंग जाँचें", "PDF अपलोड किए बिना सख्त और सहनशील पार्सर की तुलना करें और सीमित संरचनात्मक संकेतों की जाँच करें।", "त्वरित संरचना जाँच", "गहन पेज जाँच", "चुनी गई PDF का निदान करें", "PDF संरचना सामान्य करें", "पेज सामग्री फिर बनाएँ", "Document Doctor खोलें"),
}

def migrate(locale, core):
    h1, intro, quick, deep, diagnose, normalize, rebuild, open_cta = core
    privacy = locale["common.privacy_note"]
    limits = locale["privacy_scan.limits"]
    values = {
      "hub.document_doctor_title": h1, "hub.document_doctor_desc": intro,
      "hub.open_document_doctor": open_cta, "doctor.eyebrow": locale["privacy_scan.eyebrow"],
      "doctor.h1": h1, "doctor.intro": intro, "doctor.proof": privacy,
      "doctor.choose": locale["privacy_scan.choose"], "doctor.drop_aria": locale["privacy_scan.drop_aria"],
      "doctor.drop_title": locale["privacy_scan.drop_title"], "doctor.drop_help": privacy,
      "doctor.mode": quick, "doctor.quick": quick, "doctor.quick_help": intro,
      "doctor.deep": deep, "doctor.deep_help": deep + " — " + locale["workflows.device_limit"],
      "doctor.diagnose": diagnose, "doctor.results": diagnose, "doctor.signature_warning": locale["privacy_scan.signature_warning"],
      "doctor.readiness_warning": limits, "doctor.actions": locale["workflows.review_changes"],
      "doctor.normalize": normalize, "doctor.normalize_help": normalize + ". " + limits,
      "doctor.normalize_btn": normalize, "doctor.rebuild": rebuild,
      "doctor.rebuild_help": rebuild + ". " + locale["workflows.step_compress_raster_v1_loss"], "doctor.rebuild_btn": rebuild,
      "doctor.ready": locale["privacy_scan.ready"], "doctor.download": locale["privacy_scan.download"],
      "doctor.limits_title": locale["privacy_scan.limits_title"], "doctor.limits": limits,
      "doctor.footer": privacy, "doctor.summary": diagnose + ": {pages} / {mode} / {warnings}",
      "doctor.strict_parse": quick, "doctor.tolerant_parse": quick, "doctor.pdfjs_parse": quick,
      "doctor.pass": locale["common.js_done"], "doctor.not_confirmed": limits,
      "doctor.page_boxes": deep, "doctor.encrypted": locale["privacy_scan.category_standardMetadata"],
      "doctor.yes": locale["common.js_done"], "doctor.no": "—",
      "doctor.structure_tree": deep, "doctor.mark_info": deep, "doctor.language": deep,
      "doctor.title": locale["privacy_scan.category_standardMetadata"], "doctor.alt_missing": deep,
      "doctor.graph_truncated": deep + " — 1,000", "doctor.inspection_errors": diagnose + " — ?",
      "doctor.deep_pages": deep, "doctor.deep_errors": deep, "doctor.loading": locale["common.preparing"],
      "doctor.checking_page": deep + " {page}/{pages}", "doctor.too_large": locale["privacy_scan.too_large"],
      "doctor.read_failed": locale["privacy_scan.failed"], "doctor.diagnose_failed": locale["privacy_scan.failed"],
      "doctor.transforming": locale["privacy_scan.cleaning"], "doctor.verified": locale["privacy_scan.verified"],
      "doctor.transform_failed": locale["privacy_scan.cleanup_failed"],
    }
    feature_keys = ["standardMetadata", "xmp", "catalogAttachments", "pageAttachments", "annotations", "linksAndActions", "documentJavaScript", "pageJavaScript", "forms", "calculationOrder", "signatureFields", "permissions"]
    for key in feature_keys:
        values[f"doctor.feature_{key}"] = locale.get(f"privacy_scan.category_{key}", deep)
    locale.update(values)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    original = PATH.read_text(encoding="utf-8")
    data = json.loads(original)
    if set(data) != set(CORE): raise SystemExit("Phase 6 locale map mismatch")
    for language, locale in data.items(): migrate(locale, CORE[language])
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original: raise SystemExit("Phase 6 translation migration is not up to date")
    else:
        PATH.write_text(rendered, encoding="utf-8")

if __name__ == "__main__": main()
