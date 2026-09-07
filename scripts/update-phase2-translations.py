#!/usr/bin/env python3
"""Apply deterministic Phase 2 workspace labels to all translated locales."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS = ROOT / "public" / "translations.json"

# popular, browse_all, result_count, find_tool, add_two, ready, download_again
COPY = {
    "es": ("Herramientas populares", "Explorar las 29 herramientas", "{n} herramientas encontradas", "¿Qué desea hacer?", "Añada al menos dos PDF para combinarlos.", "Su PDF combinado está listo", "Descargar de nuevo"),
    "fr": ("Outils populaires", "Parcourir les 29 outils", "{n} outils trouvés", "Que souhaitez-vous faire ?", "Ajoutez au moins deux PDF à fusionner.", "Votre PDF fusionné est prêt", "Télécharger à nouveau"),
    "de": ("Beliebte Werkzeuge", "Alle 29 Werkzeuge ansehen", "{n} Werkzeuge gefunden", "Was möchten Sie tun?", "Fügen Sie mindestens zwei PDFs zum Zusammenführen hinzu.", "Ihre zusammengeführte PDF ist bereit", "Erneut herunterladen"),
    "pt": ("Ferramentas populares", "Ver todas as 29 ferramentas", "{n} ferramentas encontradas", "O que pretende fazer?", "Adicione pelo menos dois PDFs para combinar.", "O seu PDF combinado está pronto", "Transferir novamente"),
    "it": ("Strumenti popolari", "Sfoglia tutti i 29 strumenti", "{n} strumenti trovati", "Cosa vuoi fare?", "Aggiungi almeno due PDF da unire.", "Il PDF unito è pronto", "Scarica di nuovo"),
    "ru": ("Популярные инструменты", "Посмотреть все 29 инструментов", "Найдено инструментов: {n}", "Что вы хотите сделать?", "Добавьте не менее двух PDF для объединения.", "Объединённый PDF готов", "Скачать ещё раз"),
    "ja": ("人気のツール", "29 個のツールをすべて表示", "{n} 個のツールが見つかりました", "何をしますか？", "結合する PDF を 2 つ以上追加してください。", "結合した PDF の準備ができました", "もう一度ダウンロード"),
    "ko": ("인기 도구", "29개 도구 모두 보기", "{n}개 도구 찾음", "무엇을 하시겠어요?", "병합할 PDF를 두 개 이상 추가하세요.", "병합된 PDF가 준비되었습니다", "다시 다운로드"),
    "zh": ("常用工具", "浏览全部 29 个工具", "找到 {n} 个工具", "您想做什么？", "请至少添加两个 PDF 进行合并。", "合并后的 PDF 已准备好", "再次下载"),
    "zh-TW": ("常用工具", "瀏覽全部 29 個工具", "找到 {n} 個工具", "您想做什麼？", "請至少加入兩個 PDF 進行合併。", "合併後的 PDF 已準備好", "再次下載"),
    "ar": ("الأدوات الشائعة", "تصفح جميع الأدوات الـ29", "تم العثور على {n} أداة", "ماذا تريد أن تفعل؟", "أضف ملفي PDF على الأقل للدمج.", "ملف PDF المدمج جاهز", "تنزيل مرة أخرى"),
    "hi": ("लोकप्रिय टूल", "सभी 29 टूल देखें", "{n} टूल मिले", "आप क्या करना चाहते हैं?", "मर्ज करने के लिए कम से कम दो PDF जोड़ें।", "आपका मर्ज किया गया PDF तैयार है", "फिर से डाउनलोड करें"),
    "tr": ("Popüler araçlar", "29 aracın tümüne göz at", "{n} araç bulundu", "Ne yapmak istiyorsunuz?", "Birleştirmek için en az iki PDF ekleyin.", "Birleştirilmiş PDF dosyanız hazır", "Tekrar indir"),
    "nl": ("Populaire tools", "Bekijk alle 29 tools", "{n} tools gevonden", "Wat wilt u doen?", "Voeg minstens twee PDF's toe om samen te voegen.", "Uw samengevoegde PDF is klaar", "Opnieuw downloaden"),
    "pl": ("Popularne narzędzia", "Przeglądaj wszystkie 29 narzędzi", "Znaleziono narzędzi: {n}", "Co chcesz zrobić?", "Dodaj co najmniej dwa pliki PDF do połączenia.", "Połączony PDF jest gotowy", "Pobierz ponownie"),
    "id": ("Alat populer", "Lihat semua 29 alat", "{n} alat ditemukan", "Apa yang ingin Anda lakukan?", "Tambahkan setidaknya dua PDF untuk digabungkan.", "PDF gabungan Anda siap", "Unduh lagi"),
    "vi": ("Công cụ phổ biến", "Xem tất cả 29 công cụ", "Đã tìm thấy {n} công cụ", "Bạn muốn làm gì?", "Thêm ít nhất hai PDF để hợp nhất.", "PDF đã hợp nhất của bạn đã sẵn sàng", "Tải xuống lại"),
    "th": ("เครื่องมือยอดนิยม", "ดูเครื่องมือทั้ง 29 รายการ", "พบ {n} เครื่องมือ", "คุณต้องการทำอะไร?", "เพิ่ม PDF อย่างน้อยสองไฟล์เพื่อรวม", "PDF ที่รวมแล้วพร้อมใช้งาน", "ดาวน์โหลดอีกครั้ง"),
    "uk": ("Популярні інструменти", "Переглянути всі 29 інструментів", "Знайдено інструментів: {n}", "Що ви хочете зробити?", "Додайте щонайменше два PDF для об’єднання.", "Об’єднаний PDF готовий", "Завантажити ще раз"),
    "cs": ("Oblíbené nástroje", "Procházet všech 29 nástrojů", "Nalezeno nástrojů: {n}", "Co chcete udělat?", "Přidejte alespoň dva PDF soubory ke sloučení.", "Sloučené PDF je připraveno", "Stáhnout znovu"),
    "sv": ("Populära verktyg", "Visa alla 29 verktyg", "{n} verktyg hittades", "Vad vill du göra?", "Lägg till minst två PDF-filer att slå ihop.", "Din sammanfogade PDF är klar", "Ladda ner igen"),
}

# Action-led home introduction, task-search hint, and reorder announcement.
# These are explicit rather than copied from generic/free/filter strings so the
# homepage keeps the same intent-first meaning in every supported language.
INTENT_COPY = {
    "es": ("Encuentre la herramienta adecuada para lo que necesita hacer.", "Busque por tarea, por ejemplo combinar, comprimir o convertir.", "Se movió {name} a la posición {position} de {total}."),
    "fr": ("Trouvez l’outil adapté à ce que vous voulez faire.", "Recherchez par tâche, par exemple fusionner, compresser ou convertir.", "{name} a été déplacé à la position {position} sur {total}."),
    "de": ("Finden Sie das passende Werkzeug für Ihr Vorhaben.", "Suchen Sie nach einer Aufgabe, etwa zusammenführen, komprimieren oder konvertieren.", "{name} wurde an Position {position} von {total} verschoben."),
    "pt": ("Encontre a ferramenta certa para o que pretende fazer.", "Pesquise por tarefa, como combinar, comprimir ou converter.", "{name} foi movido para a posição {position} de {total}."),
    "it": ("Trova lo strumento giusto per ciò che vuoi fare.", "Cerca per attività, ad esempio unire, comprimere o convertire.", "{name} è stato spostato alla posizione {position} di {total}."),
    "ru": ("Найдите подходящий инструмент для своей задачи.", "Ищите по задаче, например объединить, сжать или преобразовать.", "Файл {name} перемещён на позицию {position} из {total}."),
    "ja": ("目的に合ったツールを見つけてください。", "結合、圧縮、変換など、作業内容で検索できます。", "{name} を {total} 件中 {position} 番目に移動しました。"),
    "ko": ("하려는 작업에 알맞은 도구를 찾아보세요.", "병합, 압축, 변환 같은 작업으로 검색하세요.", "{name} 파일을 {total}개 중 {position}번째 위치로 이동했습니다."),
    "zh": ("根据您的目标找到合适的工具。", "按任务搜索，例如合并、压缩或转换。", "已将 {name} 移至第 {position} 位，共 {total} 位。"),
    "zh-TW": ("依照您的目標找到合適的工具。", "依任務搜尋，例如合併、壓縮或轉換。", "已將 {name} 移至第 {position} 位，共 {total} 位。"),
    "ar": ("اعثر على الأداة المناسبة لما تريد إنجازه.", "ابحث حسب المهمة، مثل الدمج أو الضغط أو التحويل.", "نُقل {name} إلى الموضع {position} من {total}."),
    "hi": ("अपने काम के लिए सही टूल खोजें।", "मर्ज, कंप्रेस या कन्वर्ट जैसे काम के आधार पर खोजें।", "{name} को {total} में से {position} स्थान पर ले जाया गया।"),
    "tr": ("Yapmak istediğiniz işe uygun aracı bulun.", "Birleştirme, sıkıştırma veya dönüştürme gibi görevlere göre arayın.", "{name}, {total} dosya içinde {position}. konuma taşındı."),
    "nl": ("Vind het juiste hulpmiddel voor wat u wilt doen.", "Zoek op taak, zoals samenvoegen, comprimeren of converteren.", "{name} is verplaatst naar positie {position} van {total}."),
    "pl": ("Znajdź właściwe narzędzie do swojego zadania.", "Szukaj według zadania, na przykład łączenia, kompresji lub konwersji.", "Plik {name} przeniesiono na pozycję {position} z {total}."),
    "id": ("Temukan alat yang tepat untuk tujuan Anda.", "Cari berdasarkan tugas, seperti menggabungkan, mengompres, atau mengonversi.", "{name} dipindahkan ke posisi {position} dari {total}."),
    "vi": ("Tìm công cụ phù hợp với việc bạn muốn làm.", "Tìm theo tác vụ, chẳng hạn như hợp nhất, nén hoặc chuyển đổi.", "Đã chuyển {name} đến vị trí {position} trên {total}."),
    "th": ("ค้นหาเครื่องมือที่เหมาะกับสิ่งที่คุณต้องการทำ", "ค้นหาตามงาน เช่น รวม บีบอัด หรือแปลงไฟล์", "ย้าย {name} ไปยังตำแหน่ง {position} จาก {total} แล้ว"),
    "uk": ("Знайдіть потрібний інструмент для свого завдання.", "Шукайте за завданням, наприклад об’єднати, стиснути або перетворити.", "Файл {name} переміщено на позицію {position} з {total}."),
    "cs": ("Najděte správný nástroj pro svůj úkol.", "Hledejte podle úkolu, například sloučení, kompresi nebo převod.", "Soubor {name} byl přesunut na pozici {position} z {total}."),
    "sv": ("Hitta rätt verktyg för det du vill göra.", "Sök efter uppgift, till exempel slå ihop, komprimera eller konvertera.", "{name} flyttades till position {position} av {total}."),
}


def migrate(locale, copy, intent_copy):
    popular, browse, results, find_tool, add_two, ready, download_again = copy
    intro, search_hint, order_changed = intent_copy
    locale.update({
        "hub.intro_short": intro,
        "hub.privacy_proof_title": locale["common.privacy_badge"],
        "hub.find_tool": find_tool,
        "hub.search_hint": search_hint,
        "hub.popular_tools": popular,
        "hub.popular_count": f"6 {popular.lower()}",
        "hub.browse_all": browse,
        "hub.result_count": results,
        "merge.intro_short": locale["hub.tool_merge_desc"],
        "merge.workspace_label": locale["merge.h1"],
        "merge.action_hint": add_two,
        "merge.result_title": ready,
        "merge.download_again": download_again,
        "merge.js_order_changed": order_changed,
    })
    locale.pop("hub.find_tool_hint", None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    original = TRANSLATIONS.read_text(encoding="utf-8")
    data = json.loads(original)
    if set(data) != set(COPY) or set(data) != set(INTENT_COPY):
        raise SystemExit("Phase 2 locale map does not match translations.json")
    for language, locale in data.items():
        migrate(locale, COPY[language], INTENT_COPY[language])
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original:
            raise SystemExit("Phase 2 translation migration is not up to date")
    else:
        TRANSLATIONS.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
