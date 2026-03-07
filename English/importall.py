import os
import pathlib
import requests
from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator

# --- KONFIGURACE ---
# Seznam nových slov ke zpracování (Logika: English_words.py )
words = ["I am", "You are", "He is", "She is", "It is", "We are", "They are"]
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
WORDS_FILE = "words.txt"

def main():
    # 1. STAŽENÍ ZVUKŮ A OBRÁZKŮ (Původní logika: English_words.py )
    print(">>> Fáze 1: Stahování mediálních souborů")
    for word in words:
        file_name = word.replace(" ", "_")
        search_query = word.replace(" ", "+")

        # Stažení zvuku (Pravděpodobnost úspěchu 99 %) 
        try:
            tts_url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={search_query}&tl=en&client=tw-ob"
            r_audio = requests.get(tts_url, headers=HEADERS)
            with open(f"{file_name}.mp3", "wb") as f:
                f.write(r_audio.content)
        except Exception as e:
            print(f"Chyba u zvuku pro '{word}': {e}")

        # Stažení náhledu obrázku (Pravděpodobnost úspěchu 85 %) 
        try:
            search_url = f"https://www.google.com/search?q={search_query}+clipart&tbm=isch"
            r_html = requests.get(search_url, headers=HEADERS)
            soup = BeautifulSoup(r_html.text, 'html.parser')
            img_tags = soup.find_all("img")
            img_url = None
            for img in img_tags[1:]:
                src = img.get("src")
                if src and src.startswith("http"):
                    img_url = src
                    break
            if img_url:
                r_img = requests.get(img_url)
                with open(f"{file_name}.jpg", "wb") as f:
                    f.write(r_img.content)
                print(f"Staženo: {file_name}.mp3 a .jpg")
        except Exception as e:
            print(f"Chyba u obrázku pro '{word}': {e}")

    # 2. PŘEKLAD A TVORBA .CZ SOUBORŮ (Původní logika: CZtranslate.py)
    print("\n>>> Fáze 2: Překlad a kontrola .cz souborů")
    translator = GoogleTranslator(source='en', target='cs')
    
    mp3_files = [f for f in os.listdir('.') if f.endswith('.mp3')]
    existing_cz = [f for f in os.listdir('.') if f.endswith('.cz')]

    for f in mp3_files:
        en_word = os.path.splitext(f)[0]
        # Kontrola existence: pokud soubor en-cz.cz už existuje, přeskočí se
        if any(cz.startswith(f"{en_word}-") for cz in existing_cz):
            continue

        try:
            clean_word = en_word.replace('_', ' ')
            translated = translator.translate(clean_word).lower()
            cs_word = translated.replace(' ', '_')
            new_filename = f"{en_word}-{cs_word}.cz"
            
            # Vytvoření prázdného souboru pro evidenci překladu
            with open(new_filename, 'w', encoding='utf-8') as _:
                pass
            print(f"Vytvořeno: {new_filename}")
        except Exception as e:
            print(f"Chyba u překladu '{en_word}': {e}")

# 3. AKTUALIZACE WORDS.TXT (Úprava pro zachování obsahu)
    print("\n>>> Fáze 3: Aktualizace words.txt")
    output_path = pathlib.Path(WORDS_FILE)
    directory = pathlib.Path('.')

    # Načtení existujících slov pro zabránění duplicit
    existing_lines = set()
    if output_path.exists():
        with output_path.open('r', encoding='utf-8') as f_in:
            for line in f_in:
                existing_lines.add(line.strip())

    # Režim 'a' přidá nová slova na konec souboru
    with output_path.open('a', encoding='utf-8') as f_out:
        added_count = 0
        for cz_file in sorted(directory.glob('*.cz')):
            word_pair = cz_file.stem
            # Zápis proběhne pouze pokud slovo ještě není ve words.txt
            if word_pair not in existing_lines:
                f_out.write(f"{word_pair}\n")
                existing_lines.add(word_pair)
                added_count += 1

    print(f"\nHotovo. Do {WORDS_FILE} bylo přidáno {added_count} nových slov.")

if __name__ == "__main__":
    main()