import os
import pathlib
import requests
import webbrowser
from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator

# --- KONFIGURACE ---
words_to_process = ["dog", "cat", "rabbit", "bird", "fish", "lion", "elephant", "monkey", "snake", "spider"]
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
WORDS_FILE = "words.txt"

def get_image_urls(query, limit=5):
    search_url = f"https://www.google.com/search?q={query}+clipart&tbm=isch"
    try:
        r = requests.get(search_url, headers=HEADERS)
        soup = BeautifulSoup(r.text, 'html.parser')
        img_tags = soup.find_all("img")
        
        urls = []
        for img in img_tags[1:]:
            src = img.get("src")
            if src and src.startswith("http"):
                urls.append(src)
            if len(urls) >= limit:
                break
        return urls
    except Exception as e:
        print(f"Chyba při hledání obrázků: {e}")
        return []

def main():
    translator = GoogleTranslator(source='en', target='cs')
    results_to_save = []

    for word in words_to_process:
        file_name = word.replace(" ", "_")
        
        # --- KONTROLA EXISTENCE ---
        if os.path.exists(f"{file_name}.mp3"):
            print(f"--- Slovo '{word}' již existuje (soubor {file_name}.mp3 nalezen). Přeskakuji. ---")
            continue

        print(f"\n=== Zpracovávám nové slovo: {word.upper()} ===")
        
        # 1. ZVUK (Automaticky)
        try:
            tts_url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={word}&tl=en&client=tw-ob"
            r_audio = requests.get(tts_url, headers=HEADERS)
            with open(f"{file_name}.mp3", "wb") as f:
                f.write(r_audio.content)
            print("✓ Zvuk stažen.")
        except Exception as e:
            print(f"X Chyba u zvuku: {e}")

        # 2. OBRÁZEK (Interaktivně)
        img_urls = get_image_urls(word)
        if img_urls:
            print("Dostupné obrázky (otevírám náhled v prohlížeči...):")
            webbrowser.open(f"https://www.google.com/search?q={word}+clipart&tbm=isch")
            
            for i, url in enumerate(img_urls):
                print(f"[{i+1}] {url[:60]}...")
            
            choice = input("Vyber číslo obrázku (1-5) nebo vlož vlastní URL: ")
            
            try:
                if choice.isdigit() and 1 <= int(choice) <= len(img_urls):
                    selected_url = img_urls[int(choice)-1]
                else:
                    selected_url = choice # Předpokládáme, že uživatel vložil přímou URL

                r_img = requests.get(selected_url)
                with open(f"{file_name}.jpg", "wb") as f:
                    f.write(r_img.content)
                print("✓ Obrázek uložen.")
            except:
                print("X Nepodařilo se stáhnout vybraný obrázek.")
        else:
            print("X Žádné obrázky nebyly nalezeny.")

        # 3. PŘEKLAD (Interaktivně)
        try:
            suggestion = translator.translate(word).lower()
            print(f"Navržený překlad: {suggestion}")
            final_cz = input(f"Potvrď překlad (Enter) nebo napiš vlastní: ")
            if not final_cz:
                final_cz = suggestion
            
            cz_file_name = final_cz.replace(" ", "_")
            word_pair = f"{file_name}-{cz_file_name}"
            
            # Vytvoření .cz souboru pro evidenci
            with open(f"{word_pair}.cz", "w", encoding="utf-8") as _: pass
            results_to_save.append(word_pair)
        except Exception as e:
            print(f"X Chyba u překladu: {e}")

    # 4. ZÁPIS DO WORDS.TXT
    if results_to_save:
        print("\n>>> Aktualizace words.txt")
        with open(WORDS_FILE, "a", encoding="utf-8") as f:
            for pair in results_to_save:
                f.write(f"{pair}\n")
        print(f"Hotovo! Přidáno {len(results_to_save)} nových slov.")
    else:
        print("\nŽádná nová slova nebyla přidána.")

if __name__ == "__main__":
    main()