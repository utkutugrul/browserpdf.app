#!/usr/bin/env python3
"""Apply the idempotent Phase 4 workflow copy migration to all 21 locales."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS = ROOT / "public" / "translations.json"
TRANSLATED_COPY = ROOT / "scripts" / "phase4-copy.json"

# title, intro, tool description, run, cancel, clear
CORE = {
    "es": ("Flujos de trabajo PDF", "Elija una receta verificada, revise cada cambio y procese los PDF uno por uno en este dispositivo.", "Ejecute recetas de varios pasos en una cola PDF local de uno en uno.", "Ejecutar cola", "Cancelar en el siguiente límite", "Vaciar cola"),
    "fr": ("Flux de travail PDF", "Choisissez une recette vérifiée, examinez chaque modification et traitez les PDF un par un sur cet appareil.", "Exécutez des recettes en plusieurs étapes dans une file PDF locale séquentielle.", "Exécuter la file", "Annuler à la prochaine étape", "Vider la file"),
    "de": ("PDF-Arbeitsabläufe", "Wählen Sie ein geprüftes Rezept, prüfen Sie jede Änderung und verarbeiten Sie PDFs nacheinander auf diesem Gerät.", "Führen Sie mehrstufige Rezepte in einer lokalen PDF-Warteschlange nacheinander aus.", "Warteschlange starten", "Am nächsten Übergang abbrechen", "Warteschlange leeren"),
    "pt": ("Fluxos de trabalho PDF", "Escolha uma receita verificada, reveja cada alteração e processe os PDF um de cada vez neste dispositivo.", "Execute receitas de várias etapas numa fila PDF local sequencial.", "Executar fila", "Cancelar no próximo limite", "Limpar fila"),
    "it": ("Flussi di lavoro PDF", "Scegli una ricetta verificata, controlla ogni modifica ed elabora i PDF uno alla volta su questo dispositivo.", "Esegui ricette in più passaggi in una coda PDF locale sequenziale.", "Esegui coda", "Annulla al prossimo limite", "Svuota coda"),
    "ru": ("Рабочие процессы PDF", "Выберите проверенный сценарий, просмотрите все изменения и обрабатывайте PDF по одному на этом устройстве.", "Запускайте многоэтапные сценарии в локальной последовательной очереди PDF.", "Запустить очередь", "Отменить на следующем этапе", "Очистить очередь"),
    "ja": ("PDF ワークフロー", "検証済みレシピを選び、変更を確認して、この端末で PDF を一つずつ処理します。", "複数ステップのレシピをローカル PDF キューで一つずつ実行します。", "キューを実行", "次の区切りでキャンセル", "キューを消去"),
    "ko": ("PDF 워크플로", "검증된 레시피를 선택하고 변경 사항을 검토한 뒤 이 기기에서 PDF를 하나씩 처리하세요.", "로컬 PDF 대기열에서 다단계 레시피를 한 번에 하나씩 실행합니다.", "대기열 실행", "다음 경계에서 취소", "대기열 지우기"),
    "zh": ("PDF 工作流", "选择经过验证的方案，检查每项更改，然后在此设备上逐个处理 PDF。", "在本地 PDF 队列中逐个运行多步骤方案。", "运行队列", "在下一边界取消", "清空队列"),
    "zh-TW": ("PDF 工作流程", "選擇經過驗證的方案、檢查每項變更，然後在此裝置上逐一處理 PDF。", "在本機 PDF 佇列中逐一執行多步驟方案。", "執行佇列", "在下一個邊界取消", "清空佇列"),
    "ar": ("سير عمل PDF", "اختر وصفة متحققًا منها وراجع كل تغيير ثم عالج ملفات PDF واحدًا تلو الآخر على هذا الجهاز.", "شغّل وصفات متعددة الخطوات في قائمة PDF محلية تسلسلية.", "تشغيل القائمة", "الإلغاء عند الحد التالي", "مسح القائمة"),
    "hi": ("PDF वर्कफ़्लो", "सत्यापित रेसिपी चुनें, हर बदलाव देखें और इस डिवाइस पर PDF को एक-एक करके प्रोसेस करें।", "स्थानीय PDF कतार में बहु-चरणीय रेसिपी एक-एक करके चलाएँ।", "कतार चलाएँ", "अगली सीमा पर रद्द करें", "कतार साफ़ करें"),
    "tr": ("PDF iş akışları", "Doğrulanmış bir reçete seçin, her değişikliği inceleyin ve PDF'leri bu cihazda sırayla işleyin.", "Çok adımlı reçeteleri yerel PDF kuyruğunda birer birer çalıştırın.", "Kuyruğu çalıştır", "Sonraki sınırda iptal et", "Kuyruğu temizle"),
    "nl": ("PDF-workflows", "Kies een gecontroleerd recept, bekijk elke wijziging en verwerk PDF's één voor één op dit apparaat.", "Voer recepten met meerdere stappen één voor één uit in een lokale PDF-wachtrij.", "Wachtrij uitvoeren", "Bij volgende grens annuleren", "Wachtrij wissen"),
    "pl": ("Przepływy PDF", "Wybierz sprawdzoną procedurę, przejrzyj każdą zmianę i przetwarzaj pliki PDF pojedynczo na tym urządzeniu.", "Uruchamiaj wieloetapowe procedury pojedynczo w lokalnej kolejce PDF.", "Uruchom kolejkę", "Anuluj na następnym etapie", "Wyczyść kolejkę"),
    "id": ("Alur kerja PDF", "Pilih resep terverifikasi, tinjau setiap perubahan, lalu proses PDF satu per satu di perangkat ini.", "Jalankan resep bertahap satu per satu dalam antrean PDF lokal.", "Jalankan antrean", "Batalkan di batas berikutnya", "Kosongkan antrean"),
    "vi": ("Quy trình PDF", "Chọn công thức đã xác minh, xem lại từng thay đổi rồi xử lý từng PDF trên thiết bị này.", "Chạy từng công thức nhiều bước trong hàng đợi PDF cục bộ.", "Chạy hàng đợi", "Hủy tại ranh giới tiếp theo", "Xóa hàng đợi"),
    "th": ("เวิร์กโฟลว์ PDF", "เลือกสูตรที่ตรวจสอบแล้ว ทบทวนทุกการเปลี่ยนแปลง แล้วประมวลผล PDF ทีละไฟล์บนอุปกรณ์นี้", "เรียกใช้สูตรหลายขั้นตอนทีละไฟล์ในคิว PDF ภายในเครื่อง", "เรียกใช้คิว", "ยกเลิกที่ขอบเขตถัดไป", "ล้างคิว"),
    "uk": ("Робочі процеси PDF", "Виберіть перевірений сценарій, перегляньте кожну зміну та обробляйте PDF по одному на цьому пристрої.", "Запускайте багатоетапні сценарії по одному в локальній черзі PDF.", "Запустити чергу", "Скасувати на наступному етапі", "Очистити чергу"),
    "cs": ("Pracovní postupy PDF", "Vyberte ověřený postup, zkontrolujte každou změnu a zpracujte PDF po jednom v tomto zařízení.", "Spouštějte vícekrokové postupy po jednom v místní frontě PDF.", "Spustit frontu", "Zrušit na další hranici", "Vymazat frontu"),
    "sv": ("PDF-arbetsflöden", "Välj ett verifierat recept, granska varje ändring och bearbeta PDF-filer en i taget på den här enheten.", "Kör flerstegsrecept ett i taget i en lokal PDF-kö.", "Kör kön", "Avbryt vid nästa gräns", "Rensa kön"),
}

DEFAULTS = {
    "workflows.eyebrow": "Local automation", "workflows.choose_recipe": "1. Choose a recipe",
    "workflows.recipe_legend": "Starter workflow recipes", "workflows.review_changes": "2. Review changes",
    "workflows.device_limit_title": "Device limit:",
    "workflows.device_limit": "PDFs are held in local browser storage and processed with concurrency 1. Large or image-heavy batches may exhaust your device's memory or storage.",
    "workflows.non_overwrite": "Original files are never overwritten. Every output gets a deterministic new name; duplicate names receive a numeric suffix.",
    "workflows.add_files": "3. Add PDFs", "workflows.drop_aria": "Choose PDF files or drop them here",
    "workflows.drop_title": "Choose PDFs or drop them here", "workflows.drop_help": "Up to 20 files and 250 MB total per local queue.",
    "workflows.file": "File", "workflows.status": "Status", "workflows.output": "Output", "workflows.actions": "Actions",
    "workflows.queue_caption": "Local batch queue", "workflows.empty": "No PDFs added yet.",
    "workflows.download_zip": "Download successful outputs as ZIP", "workflows.download": "Download", "workflows.retry": "Retry",
    "workflows.scope_title": "Verified scope",
    "workflows.scope_body": "The privacy recipe scans and clears only standard PDF document-info fields. It does not claim to remove hidden content, attachments, scripts, annotations, or identifying pixels.",
    "workflows.privacy_note": "Selected PDFs and passwords stay on this device. Passwords are held only in memory and are not saved with resumable workflows.",
    "workflows.recipe_1": "Compress, watermark & protect", "workflows.recipe_1_desc": "Raster-compress each PDF, add a visible watermark, then require a password to open the result.",
    "workflows.recipe_2": "Organize & number pages", "workflows.recipe_2_desc": "Reverse or retain the complete page order, then stamp page numbers.",
    "workflows.recipe_3": "Scan & clean standard metadata", "workflows.recipe_3_desc": "Report standard document-info metadata, then clear those fields from a new PDF.",
    "workflows.quality": "JPEG quality", "workflows.watermark": "Watermark text", "workflows.password": "Open password (not saved)",
    "workflows.page_order": "Page order", "workflows.reverse": "Reverse all pages", "workflows.keep": "Keep current order", "workflows.start_number": "Start number",
    "workflows.scan_scope": "Scan and cleanup are limited to standard document-info metadata fields.",
    "workflows.password_error": "Enter a password of at least 4 characters before running this recipe.",
    "workflows.too_many": "This local queue accepts at most 20 files.", "workflows.too_large": "This queue is limited to 250 MB of input on this device.",
    "workflows.status_queued": "Queued", "workflows.status_running": "Running", "workflows.status_success": "Success", "workflows.status_error": "Error", "workflows.status_canceled": "Canceled",
    "workflows.scan_result": "Standard metadata fields found: {n}. Cleanup was limited to these fields.",
    "workflows.cleared": "Local queue cleared.", "workflows.resumed": "Resumed a local workflow. Passwords are not restored.",
    "workflows.run_complete": "Queue run finished. Successful outputs are ready; errors can be retried.",
    "workflows.cancelled": "Cancellation requested. Completed outputs were kept.",
    "hub.open_workflows": "Open workflows",
    "workflows.step_compress_raster_v1_title": "Compress",
    "workflows.step_compress_raster_v1_loss": "Lossy: pages are rasterized. Searchable text, links, forms, annotations, and vector detail are flattened.",
    "workflows.step_compress_raster_v1_privacy": "Page pixels stay in this browser tab; no document data is uploaded.",
    "workflows.step_watermark_text_v1_title": "Watermark",
    "workflows.step_watermark_text_v1_loss": "Non-destructive visually, but adds permanent visible text to every page.",
    "workflows.step_watermark_text_v1_privacy": "The watermark and document stay in this browser tab.",
    "workflows.step_protect_password_v1_title": "Protect",
    "workflows.step_protect_password_v1_loss": "Password encryption changes the file. Losing the password can make the output inaccessible.",
    "workflows.step_protect_password_v1_privacy": "The password is used only in memory and is never persisted in the workflow store.",
    "workflows.step_organize_pages_v1_title": "Organize pages",
    "workflows.step_organize_pages_v1_loss": "Reordering changes reading order. This starter supports keeping or reversing all pages; it does not delete pages.",
    "workflows.step_organize_pages_v1_privacy": "Document pages stay in this browser tab.",
    "workflows.step_page_numbers_v1_title": "Page numbers",
    "workflows.step_page_numbers_v1_loss": "Adds permanent visible numbering to every page.",
    "workflows.step_page_numbers_v1_privacy": "Document pages stay in this browser tab.",
    "workflows.step_privacy_metadata_scan_v1_title": "Privacy metadata scan",
    "workflows.step_privacy_metadata_scan_v1_loss": "Read-only. Scans only standard PDF document-info fields; it does not inspect hidden content, attachments, JavaScript, or image pixels.",
    "workflows.step_privacy_metadata_scan_v1_privacy": "Findings remain in this browser tab and in the local workflow record until expiry.",
    "workflows.step_metadata_cleanup_v1_title": "Metadata cleanup",
    "workflows.step_metadata_cleanup_v1_loss": "Clears standard title, author, subject, keywords, creator, producer, and document dates only. It is not a full forensic sanitizer.",
    "workflows.step_metadata_cleanup_v1_privacy": "The cleaned document stays in this browser tab.",
}

def migrate(locale, values, translated):
    title, intro, description, run, cancel, clear = values
    locale.update(translated)
    locale.update({
        "hub.tool_workflows": title, "hub.tool_workflows_desc": description,
        "workflows.h1": title, "workflows.intro": intro,
        "workflows.run": run, "workflows.cancel": cancel, "workflows.clear": clear,
    })

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    original = TRANSLATIONS.read_text(encoding="utf-8")
    data = json.loads(original)
    if set(data) != set(CORE):
        raise SystemExit("Phase 4 locale map does not match translations.json")
    translated_copy = json.loads(TRANSLATED_COPY.read_text(encoding="utf-8"))
    if set(translated_copy) != set(CORE):
        raise SystemExit("Phase 4 translated copy does not match locale map")
    for language, locale in data.items():
        if set(translated_copy[language]) != set(DEFAULTS):
            raise SystemExit(f"Phase 4 translated keys are incomplete for {language}")
        migrate(locale, CORE[language], translated_copy[language])
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original: raise SystemExit("Phase 4 translation migration is not up to date")
    else:
        TRANSLATIONS.write_text(rendered, encoding="utf-8")

if __name__ == "__main__":
    main()
