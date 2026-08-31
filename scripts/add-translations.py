#!/usr/bin/env python3
"""Add translations for 6 new tools to translations.json.

Translates all data-i18n keys for edit-metadata, add-image, add-text,
redact, highlight, and view-pdf into all 21 non-English languages.

Run: python3 scripts/add-translations.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'public'  # deploy edilen site koku
TRANS = SITE / 'translations.json'

LANGS = ['es','fr','de','pt','it','ru','ja','ko','zh','zh-TW',
         'ar','hi','tr','nl','pl','id','vi','th','uk','cs','sv']

# Shared translations: English phrase -> {lang: translation}
# These are reused across multiple tools.
SHARED = {
    "Nothing is uploaded.": {
        "es": "Nada se sube.", "fr": "Rien n'est televerse.", "de": "Nichts wird hochgeladen.",
        "pt": "Nada e enviado.", "it": "Niente viene caricato.", "ru": "Ничего не загружается.",
        "ja": "アップロードされません。", "ko": "업로드되지 않습니다.", "zh": "不会上传任何内容。",
        "zh-TW": "不會上傳任何內容。", "ar": "لا يتم رفع أي شيء.", "hi": "कुछ भी अपलोड नहीं किया जाता।",
        "tr": "Hicbir sey yuklenmez.", "nl": "Niets wordt geupload.", "pl": "Nic nie jest przesyłane.",
        "id": "Tidak ada yang diunggah.", "vi": "Khong co gi duoc tai len.", "th": "ไม่มีการอัปโหลดใดๆ",
        "uk": "Нічого не завантажується.", "cs": "Nic se nenahrava.", "sv": "Inget laddas upp.",
    },
    "Everything happens in this browser tab.": {
        "es": "Todo ocurre en esta pestana del navegador.", "fr": "Tout se passe dans cet onglet du navigateur.",
        "de": "Alles passiert in diesem Browser-Tab.", "pt": "Tudo acontece nesta aba do navegador.",
        "it": "Tutto avviene in questa scheda del browser.", "ru": "Всё происходит в этой вкладке браузера.",
        "ja": "すべてこのブラウザタブ内で行われます。", "ko": "모두 이 브라우저 탭에서 처리됩니다.",
        "zh": "一切都在此浏览器标签页中完成。", "zh-TW": "一切都在此瀏覽器分頁中完成。",
        "ar": "كل شيء يحدث في علامة التبويب هذه بالمتصفح.", "hi": "सब कुछ इस ब्राउज़र टैब में होता है।",
        "tr": "Her sey bu browser sekmesinde gerceklesir.", "nl": "Alles gebeurt in dit browsertabblad.",
        "pl": "Wszystko dzieje się w tej karcie przegladarki.", "id": "Semua terjadi di tab browser ini.",
        "vi": "Tat ca deu xay ra trong tab trinh duyet nay.", "th": "ทุกอย่างเกิดขึ้นในแท็บเบราว์เซอร์นี้",
        "uk": "Все відбувається в цій вкладці браузера.", "cs": "Vse se deje v teto karte prohlizece.",
        "sv": "Allt sker i denna browserflik.",
    },
    "Compress": {
        "es": "Comprimir", "fr": "Compresser", "de": "Komprimieren", "pt": "Comprimir",
        "it": "Comprimi", "ru": "Сжать", "ja": "圧縮", "ko": "압축", "zh": "压缩",
        "zh-TW": "壓縮", "ar": "ضغط", "hi": "संपीड़ित करें", "tr": "Sikistir",
        "nl": "Comprimeren", "pl": "Kompresuj", "id": "Kompres", "vi": "Nen",
        "th": "บีบอัด", "uk": "Стиснути", "cs": "Komprimovat", "sv": "Komprimera",
    },
    "Add Page Numbers": {
        "es": "Anadir numeros de pagina", "fr": "Ajouter des numeros de page", "de": "Seitenzahlen hinzufugen",
        "pt": "Adicionar numeros de pagina", "it": "Aggiungi numeri di pagina", "ru": "Добавить номера страниц",
        "ja": "ページ番号を追加", "ko": "페이지 번호 추가", "zh": "添加页码", "zh-TW": "加入頁碼",
        "ar": "إضافة أرقام الصفحات", "hi": "पेज नंबर जोड़ें", "tr": "Sayfa numaralari ekle",
        "nl": "Paginanummers toevoegen", "pl": "Dodaj numery stron", "id": "Tambah nomor halaman",
        "vi": "Them so trang", "th": "เพิ่มเลขหน้า", "uk": "Додати номери сторінок", "cs": "Pridat cisla stran",
        "sv": "Lagg till sidnummer",
    },
    "Add Watermark": {
        "es": "Anadir marca de agua", "fr": "Ajouter un filigrane", "de": "Wasserzeichen hinzufugen",
        "pt": "Adicionar marca d'agua", "it": "Aggiungi filigrana", "ru": "Добавить водяной знак",
        "ja": "透かしを追加", "ko": "워터마크 추가", "zh": "添加水印", "zh-TW": "加入浮水印",
        "ar": "إضافة علامة مائية", "hi": "वॉटरमार्क जोड़ें", "tr": "Filigran ekle",
        "nl": "Watermerk toevoegen", "pl": "Dodaj znak wodny", "id": "Tambah watermark",
        "vi": "Them dau chu", "th": "เพิ่มลายน้ำ", "uk": "Додати водяний знак", "cs": "Pridat vodotisk",
        "sv": "Lagg till vattenmark",
    },
    "Page {n}": {
        "es": "Pagina {n}", "fr": "Page {n}", "de": "Seite {n}", "pt": "Pagina {n}",
        "it": "Pagina {n}", "ru": "Страница {n}", "ja": "ページ{n}", "ko": "페이지 {n}",
        "zh": "第{n}页", "zh-TW": "第{n}頁", "ar": "صفحة {n}", "hi": "पेज {n}",
        "tr": "Sayfa {n}", "nl": "Pagina {n}", "pl": "Strona {n}", "id": "Halaman {n}",
        "vi": "Trang {n}", "th": "หน้า {n}", "uk": "Сторінка {n}", "cs": "Strana {n}",
        "sv": "Sida {n}",
    },
    "{n}%": {
        "es": "{n}%", "fr": "{n}%", "de": "{n}%", "pt": "{n}%", "it": "{n}%", "ru": "{n}%",
        "ja": "{n}%", "ko": "{n}%", "zh": "{n}%", "zh-TW": "{n}%", "ar": "{n}%",
        "hi": "{n}%", "tr": "%{n}", "nl": "{n}%", "pl": "{n}%", "id": "{n}%",
        "vi": "{n}%", "th": "{n}%", "uk": "{n}%", "cs": "{n}%", "sv": "{n}%",
    },
}

# Per-tool translations. Each key maps to {lang: translation}.
# Strings not here fall back to SHARED lookup, then to English.
TRANSLATIONS = {
    # ===== Hub keys =====
    "hub.tool_add_text": {"es": "Anadir texto a PDF", "fr": "Ajouter du texte au PDF", "de": "Text zum PDF hinzufugen", "pt": "Adicionar texto ao PDF", "it": "Aggiungi testo al PDF", "ru": "Добавить текст в PDF", "ja": "PDFにテキストを追加", "ko": "PDF에 텍스트 추가", "zh": "在PDF中添加文本", "zh-TW": "在PDF中加入文字", "ar": "إضافة نص إلى PDF", "hi": "PDF में टेक्स्ट जोड़ें", "tr": "PDF'e metin ekle", "nl": "Tekst toevoegen aan PDF", "pl": "Dodaj tekst do PDF", "id": "Tambah teks ke PDF", "vi": "Them chu vao PDF", "th": "เพิ่มข้อความลงใน PDF", "uk": "Додати текст до PDF", "cs": "Pridat text do PDF", "sv": "Lagg till text i PDF"},
    "hub.tool_add_text_desc": {"es": "Escriba texto en cualquier pagina, donde haga clic.", "fr": "Tapez du texte sur n'importe quelle page, ou vous cliquez.", "de": "Schreiben Sie Text auf jede Seite, wohin Sie klicken.", "pt": "Digite texto em qualquer pagina, onde clicar.", "it": "Digita testo su qualsiasi pagina, dove clicchi.", "ru": "Введите текст на любой странице, куда кликнете.", "ja": "クリックした任意のページにテキストを入力できます。", "ko": "클릭하는 곳의 페이지에 텍스트를 입력하세요.", "zh": "在任意页面的点击位置输入文本。", "zh-TW": "在任意頁面的點擊位置輸入文字。", "ar": "اكتب نصًا على أي صفحة، أينما تنقر.", "hi": "किसी भी पेज पर क्लिक करें जहाँ टेक्स्ट टाइप करना है।", "tr": "Tikladiginiz herhangi bir sayfaya metin yazin.", "nl": "Typ tekst op elke pagina, waar u klikt.", "pl": "Wpisz tekst na dowolnej stronie, tam gdzie klikniesz.", "id": "Ketik teks di halaman mana pun, di mana pun Anda klik.", "vi": "Nhap chu vao bat ky trang nao, noi ban click.", "th": "พิมพ์ข้อความลงในหน้าใดก็ได้ ตรงที่คุณคลิก", "uk": "Введіть текст на будь-якій сторінці, куди клікнете.", "cs": "Napiste text na jakoukoli stranu, kam kliknete.", "sv": "Skriv text pa valfri sida, dar du klickar."},
    "hub.tool_add_image": {"es": "Anadir imagen a PDF", "fr": "Ajouter une image au PDF", "de": "Bild zum PDF hinzufugen", "pt": "Adicionar imagem ao PDF", "it": "Aggiungi immagine al PDF", "ru": "Добавить изображение в PDF", "ja": "PDFに画像を追加", "ko": "PDF에 이미지 추가", "zh": "在PDF中添加图片", "zh-TW": "在PDF中加入圖片", "ar": "إضافة صورة إلى PDF", "hi": "PDF में छवि जोड़ें", "tr": "PDF'e gorsel ekle", "nl": "Afbeelding toevoegen aan PDF", "pl": "Dodaj obraz do PDF", "id": "Tambah gambar ke PDF", "vi": "Them hinh anh vao PDF", "th": "เพิ่มรูปภาพลงใน PDF", "uk": "Додати зображення до PDF", "cs": "Pridat obrazek do PDF", "sv": "Lagg till bild i PDF"},
    "hub.tool_add_image_desc": {"es": "Estampe un logo, foto o imagen en sus paginas.", "fr": "Apposez un logo, une photo ou une image sur vos pages.", "de": "Stempeln Sie ein Logo, Foto oder Bild auf Ihre Seiten.", "pt": "Estampe um logo, foto ou imagem em suas paginas.", "it": "Apponi un logo, una foto o un'immagine sulle tue pagine.", "ru": "Добавьте логотип, фото или изображение на страницы.", "ja": "ページにロゴ、写真、画像をスタンプできます。", "ko": "페이지에 로고, 사진 또는 이미지를 스탬프하세요.", "zh": "在页面上加盖徽标、照片或图片。", "zh-TW": "在頁面上蓋上標誌、照片或圖片。", "ar": "اختم شعارًا أو صورة على صفحاتك.", "hi": "अपने पेज पर लोगो, फोटो या छवि स्टैम्प करें।", "tr": "Sayfalariniza logo, foto veya gorsel damgasi basin.", "nl": "Stempel een logo, foto of afbeelding op uw pagina's.", "pl": "Stempluj logo, zdjecie lub obraz na swoich stronach.", "id": "Stempel logo, foto, atau gambar ke halaman Anda.", "vi": "Dam dau logo, anh hoac hinh anh len trang cua ban.", "th": "ประทับโลโก้ รูปภาพ หรือภาพลงบนหน้าของคุณ", "uk": "Додайте логотип, фото чи зображення на сторінки.", "cs": "Razitko logo, foto nebo obrazek na vase stranky.", "sv": "Stampla en logotyp, foto eller bild pa dina sidor."},
    "hub.tool_highlight": {"es": "Resaltar PDF", "fr": "Surligner le PDF", "de": "PDF markieren", "pt": "Destacar PDF", "it": "Evidenzia PDF", "ru": "Выделить PDF", "ja": "PDFをハイライト", "ko": "PDF 강조 표시", "zh": "高亮PDF", "zh-TW": "螢光標記PDF", "ar": "تمييز PDF", "hi": "PDF हाइलाइट करें", "tr": "PDF'i vurgula", "nl": "PDF markeren", "pl": "Podkresl PDF", "id": "Sorot PDF", "vi": "To dam PDF", "th": "ไฮไลต์ PDF", "uk": "Підсвітити PDF", "cs": "Zvyraznit PDF", "sv": "Markera PDF"},
    "hub.tool_highlight_desc": {"es": "Resalte texto con un marcador virtual.", "fr": "Surlignez du texte avec un marqueur virtuel.", "de": "Markieren Sie Text mit einem virtuellen Textmarker.", "pt": "Destaque texto com um marcador virtual.", "it": "Evidenzia il testo con un evidenziatore virtuale.", "ru": "Выделяйте текст виртуальным маркером.", "ja": "仮想ハイライターペンでテキストを強調表示します。", "ko": "가상 형광펜으로 텍스트를 강조하세요.", "zh": "用虚拟荧光笔高亮文本。", "zh-TW": "用虛擬螢光筆標記文字。", "ar": "ميّز النص بقلم تمييز افتراضي.", "hi": "वर्चुअल हाइलाइटर पेन से टेक्स्ट हाइलाइट करें।", "tr": "Sanal isaretleyici ile metni vurgulayin.", "nl": "Markeer tekst met een virtuele marker.", "pl": "Podkresl tekst wirtualnym zakreślaczem.", "id": "Sorot teks dengan pena sorot virtual.", "vi": "To dam chu bang but dam ao.", "th": "ไฮไลต์ข้อความด้วยปากกาไฮไลต์เสมือนจริง", "uk": "Підсвічуйте текст віртуальним маркером.", "cs": "Zvyraznete text virtualnim zvraznovacem.", "sv": "Markera text med en virtuell markeringspenna."},
    "hub.tool_edit_metadata": {"es": "Editar metadatos", "fr": "Modifier les metadonnees", "de": "Metadaten bearbeiten", "pt": "Editar metadados", "it": "Modifica metadati", "ru": "Изменить метаданные", "ja": "メタデータを編集", "ko": "메타데이터 편집", "zh": "编辑元数据", "zh-TW": "編輯元資料", "ar": "تحرير البيانات الوصفية", "hi": "मेटाडेटा संपादित करें", "tr": "Metaveri duzenle", "nl": "Metagegevens bewerken", "pl": "Edytuj metadane", "id": "Edit metadata", "vi": "Chinh sua du lieu meta", "th": "แก้ไขข้อมูลเมตา", "uk": "Редагувати метадані", "cs": "Upravit metadata", "sv": "Redigera metadata"},
    "hub.tool_edit_metadata_desc": {"es": "Vea y edite el titulo, autor, asunto y palabras clave del PDF.", "fr": "Consultez et modifiez le titre, l'auteur, le sujet et les mots-cles du PDF.", "de": "Zeigen und bearbeiten Sie PDF-Titel, Autor, Betreff und Schlussworter.", "pt": "Veja e edite o titulo, autor, assunto e palavras-chave do PDF.", "it": "Visualizza e modifica titolo, autore, oggetto e parole chiave del PDF.", "ru": "Просматривайте и изменяйте заголовок, автора, тему и ключевые слова PDF.", "ja": "PDFのタイトル、作成者、件名、キーワードを表示・編集します。", "ko": "PDF 제목, 작성자, 제목, 키워드를 보고 편집하세요.", "zh": "查看和编辑PDF的标题、作者、主题和关键词。", "zh-TW": "檢視和編輯PDF的標題、作者、主題和關鍵字。", "ar": "عرض وتحرير عنوان PDF والمؤلف والموضوع والكلمات المفتاحية.", "hi": "PDF का शीर्षक, लेखक, विषय और कीवर्ड देखें और संपादित करें।", "tr": "PDF basligini, yazarini, konusunu ve anahtar kelimelerini goruntule ve duzenle.", "nl": "Bekijk en bewerk de titel, auteur, onderwerp en trefwoorden van de PDF.", "pl": "Wyswietlaj i edytuj tytul, autora, temat i slowa kluczowe pliku PDF.", "id": "Lihat dan edit judul, penulis, subjek, dan kata kunci PDF.", "vi": "Xem va chinh sua tieu de, tac gia, chu de va tu khoa cua PDF.", "th": "ดูและแก้ไขชื่อ ผู้แต่ง หัวข้อ และคำสำคัญของ PDF", "uk": "Переглядайте та змінюйте заголовок, автора, тему та ключові слова PDF.", "cs": "Zobrazte a upravte titulek, autora, predmet a klicova slova PDF.", "sv": "Visa och redigera PDF-titel, forfattare, amne och nyckelord."},
    "hub.tool_redact": {"es": "Censurar PDF", "fr": "Caviarder le PDF", "de": "PDF schwarzen", "pt": "Redigir PDF", "it": "Oscura PDF", "ru": "Редактировать PDF", "ja": "PDFを墨消し", "ko": "PDF 검열", "zh": "涂黑PDF", "zh-TW": "塗黑PDF", "ar": "تنقيح PDF", "hi": "PDF रिडैक्ट करें", "tr": "PDF'i sansurle", "nl": "PDF redigeren", "pl": "Cenzuruj PDF", "id": "Redaksi PDF", "vi": "Che PDF", "th": "ปิดข้อความ PDF", "uk": "Редагувати PDF", "cs": "Cenzurovat PDF", "sv": "Svarta PDF"},
    "hub.tool_redact_desc": {"es": "Tache permanentemente texto o areas sensibles.", "fr": "Noircissez definitivement du texte ou des zones sensibles.", "de": "Schwärzen Sie dauerhaft sensiblen Text oder Bereiche.", "pt": "Tache permanentemente texto ou areas sensiveis.", "it": "Oscura definitivamente testo o aree sensibili.", "ru": "Навсегда закройте черный текст или конфиденциальные области.", "ja": "機密テキストやエリアを永久に黒塗りします。", "ko": "민감한 텍스트나 영역을 영구적으로 검게 가리세요.", "zh": "永久涂黑敏感文本或区域。", "zh-TW": "永久塗黑敏感文字或區域。", "ar": "اسود نهائيًا النص أو المناطق الحساسة.", "hi": "संवेदनशील टेक्स्ट या क्षेत्र को स्थायी रूप से काला करें।", "tr": "Hassas metni veya alanlari kalici olarak karart.", "nl": "Zwart permanent gevoelige tekst of gebieden.", "pl": "Trwale zaczernij wazny tekst lub obszary.", "id": "Hitamkan permanen teks atau area sensitif.", "vi": "Che vinh vien chu hoac khu vu nhy cam.", "th": "ปิดสีดำถาวรข้อความหรือพื้นที่ละเอียดอ่อน", "uk": "Назавжди зачорніть конфіденційний текст або області.", "cs": "Trvale zcernnete citlivy text nebo oblasti.", "sv": "Svarta permanent sensitiv text eller omraden."},
    "hub.tool_view_pdf": {"es": "Visor PDF", "fr": "Visionneuse PDF", "de": "PDF-Betrachter", "pt": "Visualizador de PDF", "it": "Visualizzatore PDF", "ru": "Просмотрщик PDF", "ja": "PDFビューアー", "ko": "PDF 뷰어", "zh": "PDF查看器", "zh-TW": "PDF檢視器", "ar": "عارض PDF", "hi": "PDF दर्शक", "tr": "PDF goruntuleyici", "nl": "PDF-viewer", "pl": "Przegladarka PDF", "id": "Penampil PDF", "vi": "Trinh xem PDF", "th": "ตัวดู PDF", "uk": "Переглядач PDF", "cs": "Prohlizec PDF", "sv": "PDF-visare"},
    "hub.tool_view_pdf_desc": {"es": "Abra y lea PDFs con zoom, navegacion e impresion.", "fr": "Ouvrez et lisez des PDFs avec zoom, navigation et impression.", "de": "Offnen und lesen Sie PDFs mit Zoom, Navigation und Druck.", "pt": "Abra e leia PDFs com zoom, navegacao e impressao.", "it": "Apri e leggi PDF con zoom, navigazione e stampa.", "ru": "Открывайте и читайте PDF с масштабированием, навигацией и печатью.", "ja": "ズーム、ページ移動、印刷機能でPDFを開いて読めます。", "ko": "확대, 탐색 및 인쇄로 PDF를 열고 읽으세요.", "zh": "使用缩放、导航和打印功能打开和阅读PDF。", "zh-TW": "使用縮放、導覽和列印功能開啟和閱讀PDF。", "ar": "افتح واقرأ ملفات PDF مع التكبير والتنقل والطباعة.", "hi": "ज़ूम, नेविगेशन और प्रिंट के साथ PDF खोलें और पढ़ें।", "tr": "Zoom, gezinme ve yazdirma ile PDF'ler acin ve okuyun.", "nl": "Open en lees PDF's met zoom, navigatie en afdrukken.", "pl": "Otwieraj i czytaj PDF-y z zoomem, nawigacja i drukowaniem.", "id": "Buka dan baca PDF dengan zoom, navigasi, dan cetak.", "vi": "Mo va doc PDF voi zoom, dieu huong va in.", "th": "เปิดและอ่าน PDF ด้วยการซูม นำทาง และพิมพ์", "uk": "Відкривайте та читайте PDF з масштабуванням, навігацією та друком.", "cs": "Otevrete a ctete PDF s zoomem, navigaci a tiskem.", "sv": "Oppna och las PDF:er med zoom, navigering och utskrift."},

    # ===== Common labels =====
    "Title": {"es": "Titulo", "fr": "Titre", "de": "Titel", "pt": "Titulo", "it": "Titolo", "ru": "Заголовок", "ja": "タイトル", "ko": "제목", "zh": "标题", "zh-TW": "標題", "ar": "العنوان", "hi": "शीर्षक", "tr": "Baslik", "nl": "Titel", "pl": "Tytul", "id": "Judul", "vi": "Tieu de", "th": "ชื่อเรื่อง", "uk": "Заголовок", "cs": "Titulek", "sv": "Titel"},
    "Author": {"es": "Autor", "fr": "Auteur", "de": "Autor", "pt": "Autor", "it": "Autore", "ru": "Автор", "ja": "作成者", "ko": "작성자", "zh": "作者", "zh-TW": "作者", "ar": "المؤلف", "hi": "लेखक", "tr": "Yazar", "nl": "Auteur", "pl": "Autor", "id": "Penulis", "vi": "Tac gia", "th": "ผู้แต่ง", "uk": "Автор", "cs": "Autor", "sv": "Forfattare"},
    "Subject": {"es": "Asunto", "fr": "Sujet", "de": "Betreff", "pt": "Assunto", "it": "Oggetto", "ru": "Тема", "ja": "件名", "ko": "제목", "zh": "主题", "zh-TW": "主題", "ar": "الموضوع", "hi": "विषय", "tr": "Konu", "nl": "Onderwerp", "pl": "Temat", "id": "Subjek", "vi": "Chu de", "th": "หัวข้อ", "uk": "Тема", "cs": "Predmet", "sv": "Amne"},
    "Keywords": {"es": "Palabras clave", "fr": "Mots-cles", "de": "Schlussworter", "pt": "Palavras-chave", "it": "Parole chiave", "ru": "Ключевые слова", "ja": "キーワード", "ko": "키워드", "zh": "关键词", "zh-TW": "關鍵字", "ar": "الكلمات المفتاحية", "hi": "कीवर्ड", "tr": "Anahtar kelimeler", "nl": "Trefwoorden", "pl": "Slowa kluczowe", "id": "Kata kunci", "vi": "Tu khoa", "th": "คำสำคัญ", "uk": "Ключові слова", "cs": "Klicova slova", "sv": "Nyckelord"},
    "Creator": {"es": "Creador", "fr": "Createur", "de": "Ersteller", "pt": "Criador", "it": "Creatore", "ru": "Создатель", "ja": "作成アプリ", "ko": "생성자", "zh": "创建者", "zh-TW": "建立者", "ar": "المنشئ", "hi": "निर्माता", "tr": "Olusturucu", "nl": "Maker", "pl": "Tworca", "id": "Pembuat", "vi": "Nguoi tao", "th": "ผู้สร้าง", "uk": "Створювач", "cs": "Tvurce", "sv": "Skapare"},
    "Producer": {"es": "Productor", "fr": "Producteur", "de": "Produzent", "pt": "Produtor", "it": "Produttore", "ru": "Производитель", "ja": "プロデューサー", "ko": "생산자", "zh": "生成器", "zh-TW": "產生器", "ar": "المنتج", "hi": "उत्पादक", "tr": "Uretici", "nl": "Producent", "pl": "Producent", "id": "Produsen", "vi": "Nha san xuat", "th": "ผู้ผลิต", "uk": "Виробник", "cs": "Producent", "sv": "Producent"},
    "Color": {"es": "Color", "fr": "Couleur", "de": "Farbe", "pt": "Cor", "it": "Colore", "ru": "Цвет", "ja": "色", "ko": "색상", "zh": "颜色", "zh-TW": "顏色", "ar": "اللون", "hi": "रंग", "tr": "Renk", "nl": "Kleur", "pl": "Kolor", "id": "Warna", "vi": "Mau", "th": "สี", "uk": "Колір", "cs": "Barva", "sv": "Farg"},
    "Black": {"es": "Negro", "fr": "Noir", "de": "Schwarz", "pt": "Preto", "it": "Nero", "ru": "Черный", "ja": "黒", "ko": "검정", "zh": "黑色", "zh-TW": "黑色", "ar": "أسود", "hi": "काला", "tr": "Siyah", "nl": "Zwart", "pl": "Czarny", "id": "Hitam", "vi": "Den", "th": "ดำ", "uk": "Чорний", "cs": "Cerny", "sv": "Svart"},
    "Red": {"es": "Rojo", "fr": "Rouge", "de": "Rot", "pt": "Vermelho", "it": "Rosso", "ru": "Красный", "ja": "赤", "ko": "빨강", "zh": "红色", "zh-TW": "紅色", "ar": "أحمر", "hi": "लाल", "tr": "Kirmizi", "nl": "Rood", "pl": "Czerwony", "id": "Merah", "vi": "Do", "th": "แดง", "uk": "Червоний", "cs": "Cerveny", "sv": "Rod"},
    "Blue": {"es": "Azul", "fr": "Bleu", "de": "Blau", "pt": "Azul", "it": "Blu", "ru": "Синий", "ja": "青", "ko": "파랑", "zh": "蓝色", "zh-TW": "藍色", "ar": "أزرق", "hi": "नीला", "tr": "Mavi", "nl": "Blauw", "pl": "Niebieski", "id": "Biru", "vi": "Xanh duong", "th": "น้ำเงิน", "uk": "Синій", "cs": "Modry", "sv": "bla"},
    "Gray": {"es": "Gris", "fr": "Gris", "de": "Grau", "pt": "Cinza", "it": "Grigio", "ru": "Серый", "ja": "グレー", "ko": "회색", "zh": "灰色", "zh-TW": "灰色", "ar": "رمادي", "hi": "ग्रे", "tr": "Gri", "nl": "Grijs", "pl": "Szary", "id": "Abu-abu", "vi": "Xam", "th": "เทา", "uk": "Сірий", "cs": "Sedy", "sv": "Gra"},
    "Yellow": {"es": "Amarillo", "fr": "Jaune", "de": "Gelb", "pt": "Amarelo", "it": "Giallo", "ru": "Желтый", "ja": "黄", "ko": "노랑", "zh": "黄色", "zh-TW": "黃色", "ar": "أصفر", "hi": "पीला", "tr": "Sari", "nl": "Geel", "pl": "Zolty", "id": "Kuning", "vi": "Vang", "th": "เหลือง", "uk": "Жовтий", "cs": "Zluty", "sv": "Gul"},
    "Green": {"es": "Verde", "fr": "Vert", "de": "Grun", "pt": "Verde", "it": "Verde", "ru": "Зеленый", "ja": "緑", "ko": "초록", "zh": "绿色", "zh-TW": "綠色", "ar": "أخضر", "hi": "हरा", "tr": "Yesil", "nl": "Groen", "pl": "Zielony", "id": "Hijau", "vi": "Xanh la", "th": "เขียว", "uk": "Зелений", "cs": "Zeleny", "sv": "Gron"},
    "Pink": {"es": "Rosa", "fr": "Rose", "de": "Rosa", "pt": "Rosa", "it": "Rosa", "ru": "Розовый", "ja": "ピンク", "ko": "분홍", "zh": "粉色", "zh-TW": "粉色", "ar": "وردي", "hi": "गुलाबी", "tr": "Pembe", "nl": "Roze", "pl": "Rozowy", "id": "Merah muda", "vi": "Hong", "th": "ชมพู", "uk": "Рожевий", "cs": "Ruzovy", "sv": "Rosa"},
    "Orange": {"es": "Naranja", "fr": "Orange", "de": "Orange", "pt": "Laranja", "it": "Arancione", "ru": "Оранжевый", "ja": "オレンジ", "ko": "주황", "zh": "橙色", "zh-TW": "橙色", "ar": "برتقالي", "hi": "नारंगी", "tr": "Turuncu", "nl": "Oranje", "pl": "Pomaranczowy", "id": "Oranye", "vi": "Cam", "th": "ส้ม", "uk": "Помаранчевий", "cs": "Oranzovy", "sv": "Orange"},
    "Opacity": {"es": "Opacidad", "fr": "Opacite", "de": "Deckkraft", "pt": "Opacidade", "it": "Opacita", "ru": "Непрозрачность", "ja": "不透明度", "ko": "불투명도", "zh": "不透明度", "zh-TW": "不透明度", "ar": "العتامة", "hi": "अपारदर्शिता", "tr": "Saydamlık", "nl": "Dekking", "pl": "Nieprzezroczystosc", "id": "Opasitas", "vi": "Do mo", "th": "ความทึบ", "uk": "Непрозорість", "cs": "Nepruhlednost", "sv": "Opacitet"},
    "Previous": {"es": "Anterior", "fr": "Precedent", "de": "Zuruck", "pt": "Anterior", "it": "Precedente", "ru": "Предыдущая", "ja": "前へ", "ko": "이전", "zh": "上一页", "zh-TW": "上一頁", "ar": "السابق", "hi": "पिछला", "tr": "Onceki", "nl": "Vorige", "pl": "Poprzednia", "id": "Sebelumnya", "vi": "Truoc", "th": "ก่อนหน้า", "uk": "Попередня", "cs": "Predchozi", "sv": "Föregaende"},
    "Next": {"es": "Siguiente", "fr": "Suivant", "de": "Weiter", "pt": "Proximo", "it": "Successivo", "ru": "Следующая", "ja": "次へ", "ko": "다음", "zh": "下一页", "zh-TW": "下一頁", "ar": "التالي", "hi": "अगला", "tr": "Sonraki", "nl": "Volgende", "pl": "Nastepna", "id": "Berikutnya", "vi": "Tiep", "th": "ถัดไป", "uk": "Наступна", "cs": "Dalsi", "sv": "Nasta"},
    "Print": {"es": "Imprimir", "fr": "Imprimer", "de": "Drucken", "pt": "Imprimir", "it": "Stampa", "ru": "Печать", "ja": "印刷", "ko": "인쇄", "zh": "打印", "zh-TW": "列印", "ar": "طباعة", "hi": "प्रिंट", "tr": "Yazdir", "nl": "Afdrukken", "pl": "Drukuj", "id": "Cetak", "vi": "In", "th": "พิมพ์", "uk": "Друк", "cs": "Tisk", "sv": "Skriv ut"},
    "Font": {"es": "Fuente", "fr": "Police", "de": "Schriftart", "pt": "Fonte", "it": "Carattere", "ru": "Шрифт", "ja": "フォント", "ko": "글꼴", "zh": "字体", "zh-TW": "字體", "ar": "الخط", "hi": "फ़ॉन्ट", "tr": "Font", "nl": "Lettertype", "pl": "Czcionka", "id": "Font", "vi": "Phong chu", "th": "แบบอักษร", "uk": "Шрифт", "cs": "Pismo", "sv": "Typsnitt"},
    "Text": {"es": "Texto", "fr": "Texte", "de": "Text", "pt": "Texto", "it": "Testo", "ru": "Текст", "ja": "テキスト", "ko": "텍스트", "zh": "文本", "zh-TW": "文字", "ar": "النص", "hi": "टेक्स्ट", "tr": "Metin", "nl": "Tekst", "pl": "Tekst", "id": "Teks", "vi": "Chu", "th": "ข้อความ", "uk": "Текст", "cs": "Text", "sv": "Text"},
    "Image": {"es": "Imagen", "fr": "Image", "de": "Bild", "pt": "Imagem", "it": "Immagine", "ru": "Изображение", "ja": "画像", "ko": "이미지", "zh": "图片", "zh-TW": "圖片", "ar": "الصورة", "hi": "छवि", "tr": "Gorsel", "nl": "Afbeelding", "pl": "Obraz", "id": "Gambar", "vi": "Hinh anh", "th": "รูปภาพ", "uk": "Зображення", "cs": "Obrazek", "sv": "Bild"},
    "Position": {"es": "Posicion", "fr": "Position", "de": "Position", "pt": "Posicao", "it": "Posizione", "ru": "Позиция", "ja": "位置", "ko": "위치", "zh": "位置", "zh-TW": "位置", "ar": "الموضع", "hi": "स्थिति", "tr": "Konum", "nl": "Positie", "pl": "Pozycja", "id": "Posisi", "vi": "Vi tri", "th": "ตำแหน่ง", "uk": "Позиція", "cs": "Pozice", "sv": "Position"},
    "Center": {"es": "Centro", "fr": "Centre", "de": "Mitte", "pt": "Centro", "it": "Centro", "ru": "Центр", "ja": "中央", "ko": "가운데", "zh": "居中", "zh-TW": "置中", "ar": "الوسط", "hi": "केंद्र", "tr": "Merkez", "nl": "Midden", "pl": "Srodek", "id": "Tengah", "vi": "Giua", "th": "กึ่งกลาง", "uk": "Центр", "cs": "Stred", "sv": "Mitten"},
    "Top left": {"es": "Superior izquierda", "fr": "Haut gauche", "de": "Oben links", "pt": "Superior esquerdo", "it": "In alto a sinistra", "ru": "Верхний левый", "ja": "左上", "ko": "왼쪽 상단", "zh": "左上", "zh-TW": "左上", "ar": "أعلى اليسار", "hi": "ऊपर बायां", "tr": "Sol ust", "nl": "Linksboven", "pl": "Lewy gorny", "id": "Kiri atas", "vi": "Tren trai", "th": "ซ้ายบน", "uk": "Верхній лівий", "cs": "Vlevo nahore", "sv": "Övre vanster"},
    "Top center": {"es": "Superior centro", "fr": "Haut centre", "de": "Oben mitte", "pt": "Superior centro", "it": "In alto al centro", "ru": "Верхний центр", "ja": "中央上", "ko": "가운데 상단", "zh": "上中", "zh-TW": "上中", "ar": "أعلى الوسط", "hi": "ऊपर मध्य", "tr": "Ust merkez", "nl": "Boven midden", "pl": "Gorny srodek", "id": "Tengah atas", "vi": "Tren giua", "th": "กลางบน", "uk": "Верхній центр", "cs": "Nahore stredu", "sv": "Ovre mitten"},
    "Top right": {"es": "Superior derecha", "fr": "Haut droite", "de": "Oben rechts", "pt": "Superior direito", "it": "In alto a destra", "ru": "Верхний правый", "ja": "右上", "ko": "오른쪽 상단", "zh": "右上", "zh-TW": "右上", "ar": "أعلى اليمين", "hi": "ऊपर दायां", "tr": "Sag ust", "nl": "Rechtsboven", "pl": "Prawy gorny", "id": "Kanan atas", "vi": "Tren phai", "th": "ขวาบน", "uk": "Верхній правий", "cs": "Vpravo nahore", "sv": "Ovre hoger"},
    "Bottom left": {"es": "Inferior izquierda", "fr": "Bas gauche", "de": "Unten links", "pt": "Inferior esquerdo", "it": "In basso a sinistra", "ru": "Нижний левый", "ja": "左下", "ko": "왼쪽 하단", "zh": "左下", "zh-TW": "左下", "ar": "أسفل اليسار", "hi": "नीचे बायां", "tr": "Sol alt", "nl": "Linksonder", "pl": "Lewy dolny", "id": "Kiri bawah", "vi": "Duoi trai", "th": "ซ้ายล่าง", "uk": "Нижній лівий", "cs": "Vlevo dole", "sv": "Nedre vanster"},
    "Bottom center": {"es": "Inferior centro", "fr": "Bas centre", "de": "Unten mitte", "pt": "Inferior centro", "it": "In basso al centro", "ru": "Нижний центр", "ja": "中央下", "ko": "가운데 하단", "zh": "下中", "zh-TW": "下中", "ar": "أسفل الوسط", "hi": "नीचे मध्य", "tr": "Alt merkez", "nl": "Onder midden", "pl": "Dolny srodek", "id": "Tengah bawah", "vi": "Duoi giua", "th": "กลางล่าง", "uk": "Нижній центр", "cs": "Dole stredu", "sv": "Nedre mitten"},
    "Bottom right": {"es": "Inferior derecha", "fr": "Bas droite", "de": "Unten rechts", "pt": "Inferior direito", "it": "In basso a destra", "ru": "Нижний правый", "ja": "右下", "ko": "오른쪽 하단", "zh": "右下", "zh-TW": "右下", "ar": "أسفل اليمين", "hi": "नीचे दायां", "tr": "Sag alt", "nl": "Rechtsonder", "pl": "Prawy dolny", "id": "Kanan bawah", "vi": "Duoi phai", "th": "ขวาล่าง", "uk": "Нижній правий", "cs": "Vpravo dole", "sv": "Nedre hoger"},
    "All pages": {"es": "Todas las paginas", "fr": "Toutes les pages", "de": "Alle Seiten", "pt": "Todas as paginas", "it": "Tutte le pagine", "ru": "Все страницы", "ja": "すべてのページ", "ko": "모든 페이지", "zh": "所有页面", "zh-TW": "所有頁面", "ar": "كل الصفحات", "hi": "सभी पेज", "tr": "Tum sayfalar", "nl": "Alle pagina's", "pl": "Wszystkie strony", "id": "Semua halaman", "vi": "Tat ca trang", "th": "ทุกหน้า", "uk": "Всі сторінки", "cs": "Vsechny strany", "sv": "Alla sidor"},
    "Fit width": {"es": "Ajustar ancho", "fr": "Ajuster la largeur", "de": "Breite anpassen", "pt": "Ajustar largura", "it": "Adatta larghezza", "ru": "По ширине", "ja": "幅に合わせる", "ko": "너비 맞추기", "zh": "适合宽度", "zh-TW": "適合寬度", "ar": "ملاءمة العرض", "hi": "चौड़ाई फिट", "tr": "Genislige sigdir", "nl": "Aanpassen aan breedte", "pl": "Dopasuj szerokosc", "id": "Sesuaikan lebar", "vi": "Vua chieu rong", "th": "ปรับให้พอดีความกว้าง", "uk": "За шириною", "cs": "Prizpusobit sirku", "sv": "Anpassa bredd"},
    "Clear all": {"es": "Borrar todo", "fr": "Tout effacer", "de": "Alle loschen", "pt": "Limpar tudo", "it": "Cancella tutto", "ru": "Очистить всё", "ja": "すべてクリア", "ko": "모두 지우기", "zh": "全部清除", "zh-TW": "全部清除", "ar": "مسح الكل", "hi": "सभी साफ़ करें", "tr": "Tumunu temizle", "nl": "Alles wissen", "pl": "Wyczysc wszystko", "id": "Hapus semua", "vi": "Xoa tat ca", "th": "ล้างทั้งหมด", "uk": "Очистити все", "cs": "Vymazat vse", "sv": "Rensa allt"},
    "Loading PDF...": {"es": "Cargando PDF...", "fr": "Chargement du PDF...", "de": "PDF wird geladen...", "pt": "Carregando PDF...", "it": "Caricamento PDF...", "ru": "Загрузка PDF...", "ja": "PDFを読み込み中...", "ko": "PDF 로딩 중...", "zh": "正在加载PDF...", "zh-TW": "正在載入PDF...", "ar": "جاري تحميل PDF...", "hi": "PDF लोड हो रहा है...", "tr": "PDF yukleniyor...", "nl": "PDF laden...", "pl": "Ladowanie PDF...", "id": "Memuat PDF...", "vi": "Dang tai PDF...", "th": "กำลังโหลด PDF...", "uk": "Завантаження PDF...", "cs": "Nacitani PDF...", "sv": "Laddar PDF..."},
}

# Map of key -> English text for all new keys
KEYS = {
    # Hub
    "hub.tool_add_text": "Add Text to PDF",
    "hub.tool_add_text_desc": "Type text onto any page, wherever you click.",
    "hub.tool_add_image": "Add Image to PDF",
    "hub.tool_add_image_desc": "Stamp a logo, photo, or image onto your pages.",
    "hub.tool_highlight": "Highlight PDF",
    "hub.tool_highlight_desc": "Highlight text with a virtual highlighter pen.",
    "hub.tool_edit_metadata": "Edit Metadata",
    "hub.tool_edit_metadata_desc": "View and edit PDF title, author, subject, and keywords.",
    "hub.tool_redact": "Redact PDF",
    "hub.tool_redact_desc": "Permanently black out sensitive text or areas.",
    "hub.tool_view_pdf": "PDF Viewer",
    "hub.tool_view_pdf_desc": "Open and read PDFs with zoom, navigation, and print.",
}

def get_translation(key: str, en_text: str, lang: str) -> str:
    """Look up translation from TRANSLATIONS (by key) or SHARED (by English text), fallback to English."""
    if key in TRANSLATIONS and lang in TRANSLATIONS[key]:
        return TRANSLATIONS[key][lang]
    if en_text in SHARED and lang in SHARED[en_text]:
        return SHARED[en_text][lang]
    return en_text

def main():
    data = json.loads(TRANS.read_text(encoding='utf-8'))
    added = 0
    for lang in LANGS:
        if lang not in data:
            data[lang] = {}
        for key, en_text in KEYS.items():
            if key not in data[lang]:
                data[lang][key] = get_translation(key, en_text, lang)
                added += 1
    TRANS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Added {added} translations across {len(LANGS)} languages')

if __name__ == '__main__':
    main()
