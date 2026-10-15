#include "../core/api.hpp"
#include "../core/anagrammi_indicizzati.hpp"
#include "../core/comandi.hpp"
#include "../core/ricerche.hpp"
#include "../core/testo.hpp"
#include "../core/unicode.hpp"

#include <algorithm>
#include <cassert>
#include <iostream>
#include <string>

namespace {

bool contiene(const anagrammi::Words& parole, const std::string& parola) {
    return std::find(parole.begin(), parole.end(), parola) != parole.end();
}

void test_anagrammi_indicizzati() {
    using anagrammi::Words;
    using anagrammi::dettaglio::cerca_anagrammi_indicizzati;
    using anagrammi::dettaglio::formatta_anagrammi;

    const Words vocabolario = {"non", "roma", "amor", "roma", "ramo", "mor", "oro", "", u8"caf\u00e8"};
    const auto singolo = cerca_anagrammi_indicizzati(vocabolario, "oro", 3);
    assert(singolo.size() == 1);
    assert(singolo[0].indice_vocabolario == 6);
    assert(singolo[0].lettere_non_usate.empty());
    assert((formatta_anagrammi(vocabolario, singolo) == Words{"oro"}));

    const auto multipli = cerca_anagrammi_indicizzati(vocabolario, "roma", 4);
    assert(multipli.size() == 4);
    for (std::size_t i = 0; i < multipli.size(); ++i) {
        assert(multipli[i].indice_vocabolario == i + 1);
        assert(multipli[i].lettere_non_usate.empty());
    }
    assert(vocabolario[multipli[0].indice_vocabolario] == vocabolario[multipli[2].indice_vocabolario]);
    assert(multipli[0].indice_vocabolario != multipli[2].indice_vocabolario);
    const Words attese = {"roma", "amor", "roma", "ramo"};
    assert(formatta_anagrammi(vocabolario, multipli) == attese);
    assert(anagrammi::cerca_anagrammi(vocabolario, "roma", 4) == attese);

    const auto parziali = cerca_anagrammi_indicizzati(vocabolario, "romayx", 4);
    assert(parziali.size() == 4);
    for (std::size_t i = 0; i < parziali.size(); ++i) {
        assert(parziali[i].indice_vocabolario == i + 1);
        assert(parziali[i].lettere_non_usate == "yx");
    }
    const Words attese_parziali = {"roma   [-yx]", "amor   [-yx]", "roma   [-yx]", "ramo   [-yx]"};
    assert(formatta_anagrammi(vocabolario, parziali) == attese_parziali);
    assert(anagrammi::cerca_anagrammi(vocabolario, "romayx", 4) == attese_parziali);

    const auto ripetute = cerca_anagrammi_indicizzati(vocabolario, "romaa", 4);
    assert(ripetute.size() == 4);
    for (const auto& candidato : ripetute) {
        assert(candidato.lettere_non_usate == "a");
    }
    assert((anagrammi::cerca_anagrammi(vocabolario, "romaa", 4) ==
        Words{"roma   [-a]", "amor   [-a]", "roma   [-a]", "ramo   [-a]"}));

    const auto unicode = cerca_anagrammi_indicizzati(vocabolario, u8"caff\u00e8", 4);
    assert(unicode.size() == 1);
    assert(unicode[0].indice_vocabolario == 8);
    assert(unicode[0].lettere_non_usate == "f");
    assert((formatta_anagrammi(vocabolario, unicode) == Words{u8"caf\u00e8   [-f]"}));
    assert((anagrammi::cerca_anagrammi(vocabolario, u8"caff\u00e8", 4) == Words{u8"caf\u00e8   [-f]"}));

    const auto vuota = cerca_anagrammi_indicizzati(vocabolario, "", 0);
    assert(vuota.size() == 1);
    assert(vuota[0].indice_vocabolario == 7);
    assert((formatta_anagrammi(vocabolario, vuota) == Words{""}));
    assert((anagrammi::cerca_anagrammi(vocabolario, "", 0) == Words{""}));
    assert((anagrammi::cerca_anagrammi(vocabolario, "x", 0) == Words{"   [-x]"}));
    assert(cerca_anagrammi_indicizzati({}, "roma", 4).empty());
    assert(anagrammi::cerca_anagrammi(vocabolario, "roma", 5).empty());
    assert(anagrammi::cerca_anagrammi(vocabolario, "rom", 4).empty());
    assert(anagrammi::cerca_anagrammi(vocabolario, "zzz", 3).empty());

    const auto comando = anagrammi::esegui_ricerca(vocabolario, "romayx 4");
    assert(comando.risultati == attese_parziali);
    assert(comando.footer == "- 4 corrispondenze -");
    anagrammi::MotoreAnagrammi motore(vocabolario);
    const auto pubblico = motore.esegui_comando("romayx 4");
    assert(pubblico.righe == attese_parziali);
    assert(pubblico.parole_vocabolario == attese);
    assert(pubblico.footer == comando.footer);
}

} // namespace

int main() {
    using anagrammi::Words;

    test_anagrammi_indicizzati();

    assert(anagrammi::lunghezza_utf8("andrò") == 5);
    assert(anagrammi::lunghezza_utf8("città") == 5);
    assert(anagrammi::lunghezza_utf8("àncora") == 6);
    assert(anagrammi::lunghezza_utf8("ångström") == 8);

    assert(anagrammi::normalizza_testo("ÀNCORA") == "àncora");
    assert(anagrammi::normalizza_testo("ANCÒRA") == "ancòra");
    assert(anagrammi::normalizza_testo("PÉSCA") == "pésca");
    assert(anagrammi::normalizza_testo("CITTÀ") == "città");
    assert(anagrammi::normalizza_testo("pe\xCC\x81sca") == "pésca");

    const std::string malformato{static_cast<char>(0xf0), '(', static_cast<char>(0x8c), '('};
    assert(!anagrammi::utf8_valido(malformato));
    const std::string riparato = anagrammi::normalizza_testo(malformato);
    assert(anagrammi::utf8_valido(riparato));
    assert(anagrammi::lunghezza_utf8(riparato) == 4);

    const Words vocabolario = {
        "andrò", "città", "perché", "più", "caffè", "virtù", "àncora", "ancòra",
        "pèsca", "pésca", "pesca", "ångström", "μm", "cafè"};

    const auto funzione_password = &anagrammi::password_casuali;
    assert(funzione_password != nullptr);

    const auto password_disabilitate = anagrammi::esegui_ricerca(vocabolario, "%,10,20");
    assert(password_disabilitate.risultati.empty());
    assert(password_disabilitate.footer == "Comando non disponibile.");

    const auto percentuale_mista = anagrammi::esegui_ricerca(vocabolario, "%*ésca");
    assert(percentuale_mista.risultati.empty());
    assert(percentuale_mista.footer == "Comando non disponibile.");

    anagrammi::MotoreAnagrammi motore(vocabolario);
    const auto comando_password = motore.esegui_comando("%,10,20");
    assert(comando_password.righe.empty());
    assert(comando_password.footer == "Comando non disponibile.");
    assert(motore.esegui_comando_testo("%,10,20") == "Comando non disponibile.");

    assert(contiene(anagrammi::esegui_ricerca(vocabolario, "andr?").risultati, "andrò"));
    assert(contiene(anagrammi::esegui_ricerca(vocabolario, "citt?").risultati, "città"));

    const Words pesche = anagrammi::esegui_ricerca(vocabolario, "p?sca").risultati;
    assert(contiene(pesche, "pèsca"));
    assert(contiene(pesche, "pésca"));
    assert(contiene(pesche, "pesca"));

    assert(contiene(anagrammi::esegui_ricerca(vocabolario, "*ffè").risultati, "caffè"));
    assert(contiene(anagrammi::esegui_ricerca(vocabolario, "?iù").risultati, "più"));
    const Words accento_acuto = anagrammi::esegui_ricerca(vocabolario, "*ésca").risultati;
    assert((accento_acuto == Words{"pésca"}));

    assert((anagrammi::esegui_ricerca(vocabolario, "ròand").risultati == Words{"andrò"}));
    assert((anagrammi::esegui_ricerca(vocabolario, "pesca").risultati == Words{"pesca"}));
    assert(contiene(anagrammi::esegui_ricerca(vocabolario, "$caffè").risultati, "caffè"));
    assert(contiene(anagrammi::esegui_ricerca(vocabolario, "&èff").risultati, "caffè"));

    const Words senza_grave = anagrammi::esegui_ricerca(vocabolario, "!è").risultati;
    assert(!contiene(senza_grave, "caffè"));
    assert(!contiene(senza_grave, "pèsca"));
    assert(contiene(senza_grave, "perché"));
    assert(contiene(senza_grave, "pésca"));

    const Words casuali = anagrammi::esegui_ricerca(vocabolario, "^,5,2").risultati;
    assert(casuali.size() == 5);
    assert(std::all_of(casuali.begin(), casuali.end(), [](const std::string& parola) {
        return parola == "μm";
    }));

    const Words parziali = anagrammi::esegui_ricerca(vocabolario, "caffè 4").risultati;
    assert(contiene(parziali, "cafè   [-f]"));

    std::cout << "Test Unicode superati.\n";
    return 0;
}
