#include "../core/runtime_sillabe.hpp"
#include "../core/api.hpp"
#include "../core/anagrammi_indicizzati.hpp"
#include "../core/ordinamento_rimario.hpp"
#include "../core/ricerche.hpp"
#include "../core/comandi.hpp"
#include "../core/sha256.hpp"
#include "../core/sillabe.hpp"
#include "../core/testo.hpp"

#include <algorithm>
#include <cassert>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iostream>
#include <iterator>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>

namespace allocazioni_test {
std::ptrdiff_t budget = -1;
std::size_t conteggio = 0;
bool misura = false;
}

void* operator new(std::size_t size) {
    if (allocazioni_test::budget == 0) throw std::bad_alloc();
    if (allocazioni_test::budget > 0) --allocazioni_test::budget;
    if (allocazioni_test::misura) ++allocazioni_test::conteggio;
    if (auto* ptr = std::malloc(size ? size : 1)) return ptr;
    throw std::bad_alloc();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* ptr) noexcept { std::free(ptr); }
void operator delete[](void* ptr) noexcept { std::free(ptr); }
void operator delete(void* ptr, std::size_t) noexcept { std::free(ptr); }
void operator delete[](void* ptr, std::size_t) noexcept { std::free(ptr); }

namespace {

using Bytes = std::vector<std::uint8_t>;
using anagrammi::RuntimeSillabe;
using anagrammi::VoceSillabica;
using anagrammi::StatoSillabico;
using anagrammi::OrigineSillabica;
using anagrammi::VerificheRuntimeSillabe;
constexpr auto massimo = std::numeric_limits<std::uint32_t>::max();
constexpr std::size_t directory = 272;
constexpr std::size_t bitmap = 336;
std::size_t rifiuti_verificati = 0;

template<class Errore, class Funzione>
void rifiuta(Funzione funzione) {
    bool rifiutato = false;
    try {
        funzione();
    } catch (const Errore&) {
        rifiutato = true;
    }
    assert(rifiutato);
    ++rifiuti_verificati;
}

void scrivi_le(Bytes& bytes, std::size_t offset, std::uint64_t valore, std::size_t quanti) {
    for (std::size_t i = 0; i < quanti; ++i) {
        bytes.at(offset + i) = static_cast<std::uint8_t>(valore >> (8 * i));
    }
}

void checksum(Bytes& bytes) {
    const auto hash = anagrammi::dettaglio::sha256(bytes.data() + 192, bytes.size() - 192);
    std::copy(hash.begin(), hash.end(), bytes.begin() + 128);
}

Bytes crea_fixture(const std::vector<VoceSillabica>& voci) {
    const auto n = voci.size();
    const auto stride = (n + 7) / 8;
    std::vector<std::uint32_t> valori;
    std::size_t membership = 0;
    for (const auto& voce : voci) {
        valori.insert(valori.end(), voce.conteggi.begin(), voce.conteggi.end());
        membership += voce.conteggi.size();
    }
    std::sort(valori.begin(), valori.end());
    valori.erase(std::unique(valori.begin(), valori.end()), valori.end());
    const auto directory_at = 192 + 8 * n;
    const auto bitmap_at = directory_at + 16 * valori.size();
    Bytes bytes(bitmap_at + valori.size() * stride, 0);
    const Bytes magic = {'S', 'I', 'L', 'L', 'B', 'M', 0, 0};
    std::copy(magic.begin(), magic.end(), bytes.begin());
    scrivi_le(bytes, 8, 1, 2);
    scrivi_le(bytes, 10, 192, 2);
    scrivi_le(bytes, 16, n, 4);
    scrivi_le(bytes, 20, valori.size(), 4);
    scrivi_le(bytes, 24, membership, 4);
    scrivi_le(bytes, 28, stride, 4);
    scrivi_le(bytes, 32, 192, 8);
    scrivi_le(bytes, 40, directory_at, 8);
    scrivi_le(bytes, 48, bitmap_at, 8);
    scrivi_le(bytes, 56, bytes.size(), 8);
    std::fill(bytes.begin() + 64, bytes.begin() + 96, 0x11);
    std::fill(bytes.begin() + 96, bytes.begin() + 128, 0x22);
    for (std::size_t i = 0; i < n; ++i) {
        const auto offset = 192 + 8 * i;
        scrivi_le(bytes, offset, voci[i].algoritmo, 4);
        bytes[offset + 4] = static_cast<std::uint8_t>(voci[i].stato);
        bytes[offset + 5] = static_cast<std::uint8_t>(voci[i].origine);
    }
    for (std::size_t j = 0; j < valori.size(); ++j) {
        const auto offset = bitmap_at + j * stride;
        std::size_t popolazione = 0;
        for (std::size_t i = 0; i < n; ++i) {
            if (std::find(voci[i].conteggi.begin(), voci[i].conteggi.end(), valori[j]) != voci[i].conteggi.end()) {
                bytes[offset + i / 8] |= static_cast<std::uint8_t>(1u << (i % 8));
                ++popolazione;
            }
        }
        scrivi_le(bytes, directory_at + j * 16, valori[j], 4);
        scrivi_le(bytes, directory_at + j * 16 + 4, popolazione, 4);
        scrivi_le(bytes, directory_at + j * 16 + 8, offset, 8);
    }
    checksum(bytes);
    return bytes;
}

RuntimeSillabe runtime_per_vocabolario(const std::string& testo, std::size_t n,
                                     std::uint32_t conteggio = 42) {
    auto bytes = crea_fixture(std::vector<VoceSillabica>(n,
        {{conteggio}, StatoSillabico::risolto, OrigineSillabica::automatico, conteggio}));
    const auto hash = anagrammi::dettaglio::sha256(
        reinterpret_cast<const std::uint8_t*>(testo.data()), testo.size());
    std::copy(hash.begin(), hash.end(), bytes.begin() + 64);
    return RuntimeSillabe(std::move(bytes));
}

anagrammi::RisultatoComando ricerca_precedente(
    const anagrammi::Words& parole, const std::string& comando) {
    // Oracle del vecchio adapter, confinato ai test: nessun lookup nel nuovo core.
    const auto ricerca = anagrammi::esegui_ricerca(parole, comando);
    anagrammi::RisultatoComando risultato;
    risultato.tipo = "ricerca";
    risultato.righe = ricerca.risultati;
    risultato.footer = ricerca.footer;
    if (comando.find('%') == std::string::npos) {
        const std::unordered_set<std::string> presenti(parole.begin(), parole.end());
        for (const auto& riga : risultato.righe) {
            if (presenti.find(riga) != presenti.end()) {
                risultato.parole_vocabolario.push_back(riga);
            } else {
                const auto posizione = riga.find("   [-");
                const auto parola = posizione == std::string::npos ? std::string{} : riga.substr(0, posizione);
                risultato.parole_vocabolario.push_back(
                    presenti.find(parola) == presenti.end() ? std::string{} : parola);
            }
        }
    }
    return risultato;
}

void confronta_risultati_comando(const anagrammi::RisultatoComando& a,
                                const anagrammi::RisultatoComando& b) {
    assert(a.tipo == b.tipo && a.righe == b.righe && a.parole_vocabolario == b.parole_vocabolario);
    assert(a.footer == b.footer && a.messaggio == b.messaggio);
    assert(a.parola_modificata == b.parola_modificata);
    assert(a.vocabolario_modificato == b.vocabolario_modificato);
    assert(a.richiede_salvataggio == b.richiede_salvataggio);
}

anagrammi::RisultatoComando ricomponi_pagine(
    const anagrammi::MotoreAnagrammi& motore, const anagrammi::SintesiRisultato& sintesi) {
    anagrammi::RisultatoComando risultato;
    risultato.tipo = sintesi.tipo;
    risultato.footer = sintesi.footer;
    risultato.messaggio = sintesi.messaggio;
    risultato.parola_modificata = sintesi.parola_modificata;
    risultato.vocabolario_modificato = sintesi.vocabolario_modificato;
    risultato.richiede_salvataggio = sintesi.richiede_salvataggio;
    if (!sintesi.ha_snapshot) {
        assert(sintesi.id_snapshot == 0 && sintesi.totale == 0);
        return risultato;
    }
    assert(sintesi.id_snapshot != 0);
    for (std::size_t offset = 0; offset < sintesi.totale; offset += 100) {
        const auto pagina = motore.leggi_pagina_risultato(sintesi.id_snapshot, offset, 100);
        assert(pagina.id_snapshot == sintesi.id_snapshot && pagina.offset == offset);
        assert(pagina.count == std::min(std::size_t{100}, sintesi.totale - offset));
        assert(pagina.righe.size() == pagina.count && pagina.parole_vocabolario.size() == pagina.count);
        risultato.righe.insert(risultato.righe.end(), pagina.righe.begin(), pagina.righe.end());
        risultato.parole_vocabolario.insert(risultato.parole_vocabolario.end(),
            pagina.parole_vocabolario.begin(), pagina.parole_vocabolario.end());
    }
    assert(risultato.righe.size() == sintesi.totale);
    return risultato;
}

void confronta_comando_paginato(anagrammi::MotoreAnagrammi& motore, const std::string& comando,
                              const anagrammi::FiltroSillabe* filtro = nullptr) {
    const auto completo = filtro ? motore.esegui_comando_con_filtro_sillabe(comando, *filtro)
                                 : motore.esegui_comando(comando);
    const auto sintesi = filtro ? motore.avvia_comando_paginato_con_filtro_sillabe(comando, *filtro)
                                : motore.avvia_comando_paginato(comando);
    confronta_risultati_comando(completo, ricomponi_pagine(motore, sintesi));
    if (sintesi.ha_snapshot) {
        const auto prima = motore.leggi_pagina_risultato(sintesi.id_snapshot, 0, 100);
        const auto seconda = motore.leggi_pagina_risultato(sintesi.id_snapshot, 100, 100);
        const auto riletta = motore.leggi_pagina_risultato(sintesi.id_snapshot, 0, 100);
        assert(prima.righe == riletta.righe && prima.parole_vocabolario == riletta.parole_vocabolario);
        assert(seconda.count <= 100);
        for (const auto offset : {std::size_t{0}, sintesi.totale,
                                 sintesi.totale + 1, std::numeric_limits<std::size_t>::max()}) {
            const auto vuota = motore.leggi_pagina_risultato(sintesi.id_snapshot, offset, 0);
            assert(vuota.offset == offset && vuota.count == 0 && vuota.righe.empty());
            assert(vuota.parole_vocabolario.empty());
        }
        const auto oltre = motore.leggi_pagina_risultato(
            sintesi.id_snapshot, sintesi.totale, std::numeric_limits<std::size_t>::max());
        assert(oltre.count == 0 && oltre.righe.empty() && oltre.parole_vocabolario.empty());
        const auto tutte = motore.leggi_pagina_risultato(
            sintesi.id_snapshot, 0, std::numeric_limits<std::size_t>::max());
        assert(tutte.righe == completo.righe && tutte.parole_vocabolario == completo.parole_vocabolario);
    }
}

void test_pagine_dimensioni_e_output() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    for (const std::size_t n : {0u, 1u, 99u, 100u, 101u, 10001u}) {
        Words parole;
        for (std::size_t i = 0; i < n; ++i) parole.push_back("voce" + std::to_string(i));
        MotoreAnagrammi motore(parole);
        confronta_comando_paginato(motore, "*");
        const auto sintesi = motore.avvia_comando_paginato("*");
        assert(sintesi.ha_snapshot && sintesi.totale == n);
        if (n) {
            const auto ultima = motore.leggi_pagina_risultato(sintesi.id_snapshot, (n - 1) / 100 * 100, 100);
            assert(ultima.righe.back() == parole.back());
            assert(ultima.count == (n - 1) % 100 + 1);
        }
    }
    const std::string testo = u8"roma\namor\nroma\nramo\nandr\u00e9\ncitt\u00e0\npi\u00f9\n"
        u8"pesca\np\u00e9sca\ncartone\ncarte\ndue parole\nvoce   [-interno]\nroma   [-yx]\n";
    const Words comandi = {"zzzz", "roma", "romayx 4", "cartone 5", "?om?", "r*", "*a", "*o*",
        "?o*", "?a??e*r?", "&roma", "!xyz", "$roma", "*", "due*", "voce*",
        "andr?", "citt?", "p?sca", u8"*\u00e9sca", u8"pi\u00f9", "%,10,20", "^", "", "   "};
    for (const bool personale : {false, true}) {
        MotoreAnagrammi motore;
        if (personale) motore.carica_vocabolario_da_testo(testo);
        else motore.carica_vocabolario_ordinato_con_identita(testo);
        motore.imposta_sola_lettura(!personale);
        for (const auto& comando : comandi) confronta_comando_paginato(motore, comando);
        const auto collisione = motore.avvia_comando_paginato("romayx 4");
        const auto pagina = motore.leggi_pagina_risultato(collisione.id_snapshot, 0, 100);
        assert(pagina.count == 4);
        for (std::size_t i = 0; i < pagina.count; ++i) {
            assert(pagina.righe[i] == pagina.parole_vocabolario[i] + "   [-yx]");
        }
        assert(std::count(pagina.parole_vocabolario.begin(), pagina.parole_vocabolario.end(), "roma") == 2);
        assert(std::find(pagina.parole_vocabolario.begin(), pagina.parole_vocabolario.end(), "roma   [-yx]") ==
            pagina.parole_vocabolario.end());
        const auto zero = motore.avvia_comando_paginato("zzzz");
        assert(zero.ha_snapshot && zero.totale == 0);
        assert(motore.leggi_pagina_risultato(zero.id_snapshot, 0, 100).count == 0);
        for (const auto& comando : Words{"", "  ", "%,10,20", "^"}) {
            const auto non_paginabile = motore.avvia_comando_paginato(comando);
            assert(!non_paginabile.ha_snapshot && non_paginabile.id_snapshot == 0);
            rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(zero.id_snapshot, 0, 100); });
        }
    }
}

void test_pagine_filtri_e_casuali() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    using F = anagrammi::FiltroSillabe;
    const std::string testo = u8"roma\namor\nroma\nramo\ncitt\u00e0\n";
    auto bytes = crea_fixture({
        {{2, 3}, StatoSillabico::ambiguo, OrigineSillabica::curatela_ufficiale, 2},
        {{4}, StatoSillabico::risolto, OrigineSillabica::automatico, 4},
        {{5}, StatoSillabico::risolto, OrigineSillabica::automatico, 5},
        {{2}, StatoSillabico::risolto, OrigineSillabica::automatico, 2},
        {{}, StatoSillabico::conflitto, OrigineSillabica::automatico, 2},
    });
    const auto hash = anagrammi::dettaglio::sha256(
        reinterpret_cast<const std::uint8_t*>(testo.data()), testo.size());
    std::copy(hash.begin(), hash.end(), bytes.begin() + 64);
    MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    motore.associa_runtime_sillabe(RuntimeSillabe(std::move(bytes)));
    const Words comandi = {"roma", "romayx 4", "?om?", "r*", "*o*", "?o*", "&roma", "!xyz", "$roma", "*", "zzzz"};
    for (const auto& filtro : {F::esattamente(3), F::almeno(3), F::al_massimo(3), F::tra(2, 4)}) {
        for (const auto& comando : comandi) confronta_comando_paginato(motore, comando, &filtro);
    }
    const auto ambiguo = motore.avvia_comando_paginato_con_filtro_sillabe("*", F::tra(2, 3));
    assert(motore.leggi_pagina_risultato(ambiguo.id_snapshot, 0, 100).righe == (Words{"roma", "ramo"}));
    auto runtime_originale = *motore.runtime_sillabe();
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, 5, 99));
    // La pagina legge i candidati finali: non riapplica il filtro al nuovo runtime.
    assert(motore.leggi_pagina_risultato(ambiguo.id_snapshot, 0, 100).righe == (Words{"roma", "ramo"}));
    motore.associa_runtime_sillabe(std::move(runtime_originale));
    const auto duplicati = motore.avvia_comando_paginato_con_filtro_sillabe("*", F::almeno(3));
    assert(motore.leggi_pagina_risultato(duplicati.id_snapshot, 0, 100).righe == (Words{"roma", "amor", "roma"}));
    const auto esclusi = motore.avvia_comando_paginato_con_filtro_sillabe("*", F::esattamente(99));
    assert(esclusi.ha_snapshot && esclusi.totale == 0);

    for (const bool filtrato : {false, true}) {
        const auto sintesi = filtrato
            ? motore.avvia_comando_paginato_con_filtro_sillabe("^,100000,4", F::esattamente(5))
            : motore.avvia_comando_paginato("^,100000,4");
        assert(sintesi.ha_snapshot && sintesi.totale == anagrammi::massimo_estrazioni_casuali);
        const auto prima = motore.leggi_pagina_risultato(sintesi.id_snapshot, 0, 100);
        motore.leggi_pagina_risultato(sintesi.id_snapshot, 100, 100);
        const auto riletta = motore.leggi_pagina_risultato(sintesi.id_snapshot, 0, 100);
        assert(prima.righe == riletta.righe && prima.parole_vocabolario == riletta.parole_vocabolario);
        const auto concatenato = ricomponi_pagine(motore, sintesi);
        const auto singolo = motore.leggi_pagina_risultato(sintesi.id_snapshot, 0, sintesi.totale);
        assert(concatenato.righe == singolo.righe && concatenato.parole_vocabolario == singolo.parole_vocabolario);
        assert(concatenato.parole_vocabolario == concatenato.righe);
        if (filtrato) {
            assert(std::all_of(singolo.righe.begin(), singolo.righe.end(), [](const auto& w) { return w == "roma"; }));
            assert(sintesi.footer == "- 100000 parole a caso - su 1 parole da 4 lettere");
        } else {
            for (const auto& w : singolo.righe) assert(w == "roma" || w == "amor" || w == "ramo");
            assert(sintesi.footer == "- 100000 parole a caso - su 4 parole da 4 lettere");
        }
        rifiuta<std::invalid_argument>([&] {
            if (filtrato) motore.avvia_comando_paginato_con_filtro_sillabe("^,100001,4", F::esattamente(5));
            else motore.avvia_comando_paginato("^,100001,4");
        });
        rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(sintesi.id_snapshot, 0, 100); });
    }
    const auto casuale_vuoto = motore.avvia_comando_paginato("^,100000,999");
    assert(casuale_vuoto.ha_snapshot && casuale_vuoto.totale == 0);
    const auto filtro_vuoto = motore.avvia_comando_paginato_con_filtro_sillabe("^,10,4", F::esattamente(99));
    assert(filtro_vuoto.ha_snapshot && filtro_vuoto.totale == 0);
    assert(motore.avvia_comando_paginato("^,2junk,4").totale == 2);
    assert(motore.avvia_comando_paginato("^,0,4").ha_snapshot);
}

void test_pagine_invalidazione_e_modifiche() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    using F = anagrammi::FiltroSillabe;
    MotoreAnagrammi motore(Words{"roma", "amor", "roma"});
    rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(0, 0, 100); });
    const auto a = motore.avvia_comando_paginato("*");
    const auto b = motore.avvia_comando_paginato("roma");
    assert(b.id_snapshot > a.id_snapshot);
    rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(a.id_snapshot, 0, 0); });
    motore.libera_risultato(a.id_snapshot);
    motore.libera_risultato(0);
    assert(motore.leggi_pagina_risultato(b.id_snapshot, 0, 100).count == 3);
    motore.libera_risultato(b.id_snapshot);
    motore.libera_risultato(b.id_snapshot);
    rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(b.id_snapshot, 0, 100); });
    const auto c = motore.avvia_comando_paginato("*");
    assert(c.id_snapshot > b.id_snapshot);
    motore.esegui_comando("*");
    rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(c.id_snapshot, 0, 100); });
    const auto prima_testo = motore.avvia_comando_paginato("*");
    motore.esegui_comando_testo("roma");
    rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(prima_testo.id_snapshot, 0, 100); });
    for (const bool storica : {false, true}) {
        const auto precedente = motore.avvia_comando_paginato("*");
        rifiuta<std::logic_error>([&] {
            if (storica) motore.esegui_comando_con_filtro_sillabe("*", F::esattamente(2));
            else motore.avvia_comando_paginato_con_filtro_sillabe("*", F::esattamente(2));
        });
        rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(precedente.id_snapshot, 0, 100); });
        const auto prima_errore = motore.avvia_comando_paginato("*");
        rifiuta<std::invalid_argument>([&] {
            if (storica) motore.esegui_comando("^,non-numero,4");
            else motore.avvia_comando_paginato("^,non-numero,4");
        });
        rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(prima_errore.id_snapshot, 0, 100); });
    }
    const std::string testo = "roma\namor\nramo\n";
    const std::vector<std::function<void(MotoreAnagrammi&)>> mutazioni = {
        [](auto& m) { assert(m.aggiungi_parola("nuova")); },
        [](auto& m) { assert(m.rimuovi_parola("roma")); },
        [](auto& m) { m.applica_modifiche({"roma"}, {"nuova"}); },
        [](auto& m) { m.applica_modifiche({}, {}); },
        [](auto& m) { m.sostituisci_vocabolario({"nuova", "altra"}); },
        [&](auto& m) { m.carica_vocabolario_da_testo(testo); },
        [&](auto& m) { m.carica_vocabolario_ordinato_da_testo(testo); },
        [&](auto& m) { m.carica_vocabolario_ordinato_con_identita(testo); },
    };
    for (const auto& muta : mutazioni) {
        motore.carica_vocabolario_ordinato_con_identita(testo);
        const auto precedente = motore.avvia_comando_paginato("*");
        muta(motore);
        rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(precedente.id_snapshot, 0, 100); });
        assert(motore.avvia_comando_paginato("*").id_snapshot > precedente.id_snapshot);
    }
    motore.carica_vocabolario_ordinato_con_identita(testo);
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, 3, 3));
    motore.imposta_sola_lettura(true);
    const auto protetto = motore.avvia_comando_paginato("*");
    const auto identita = motore.identita_vocabolario_sha256();
    const auto* runtime = motore.runtime_sillabe();
    for (const auto& input : Words{"ROMA\n", "roma", "roma\r\n", "roma\n\n", "\xef\xbb\xbfroma\n"}) {
        rifiuta<std::invalid_argument>([&] { motore.carica_vocabolario_ordinato_con_identita(input); });
        assert(motore.leggi_pagina_risultato(protetto.id_snapshot, 0, 100).count == 3);
        assert(motore.identita_vocabolario_sha256() == identita && motore.runtime_sillabe() == runtime);
    }
    assert(!motore.aggiungi_parola("nuova") && !motore.rimuovi_parola("roma"));
    motore.applica_modifiche({"roma"}, {"nuova"});
    assert(motore.leggi_pagina_risultato(protetto.id_snapshot, 0, 100).count == 3);
    assert(motore.identita_vocabolario_sha256() == identita && motore.runtime_sillabe() == runtime);
    motore.numero_parole();
    motore.esporta_vocabolario_testo();
    motore.cerca_anagrammi_con_filtro_sillabe("roma", 4, F::esattamente(3));
    assert(motore.leggi_pagina_risultato(protetto.id_snapshot, 0, 100).count == 3);
    motore.esegui_comando_con_filtro_sillabe("*", F::esattamente(3));
    rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(protetto.id_snapshot, 0, 100); });
    for (const bool personale : {false, true}) {
        MotoreAnagrammi storico;
        MotoreAnagrammi paginato;
        storico.carica_vocabolario_da_testo(testo);
        paginato.carica_vocabolario_da_testo(testo);
        storico.imposta_sola_lettura(!personale);
        paginato.imposta_sola_lettura(!personale);
        for (const auto& comando : Words{"+ nuova", "+ nuova", "- nuova", "- assente"}) {
            const auto precedente = paginato.avvia_comando_paginato("*");
            const auto completo = storico.esegui_comando(comando);
            const auto sintesi = paginato.avvia_comando_paginato(comando);
            assert(!sintesi.ha_snapshot);
            confronta_risultati_comando(completo, ricomponi_pagine(paginato, sintesi));
            assert(storico.vocabolario() == paginato.vocabolario());
            rifiuta<std::logic_error>([&] { paginato.leggi_pagina_risultato(precedente.id_snapshot, 0, 100); });
        }
    }
    for (const auto& comando : Words{"+ nuova", "- roma"}) {
        const auto precedente = motore.avvia_comando_paginato("*");
        rifiuta<std::invalid_argument>([&] { motore.avvia_comando_paginato_con_filtro_sillabe(comando, F::esattamente(3)); });
        assert(motore.identita_vocabolario_sha256() == identita && motore.runtime_sillabe() == runtime);
        rifiuta<std::logic_error>([&] { motore.leggi_pagina_risultato(precedente.id_snapshot, 0, 100); });
    }
}

void test_pagine_copy_move() {
    using anagrammi::MotoreAnagrammi;
    const std::string testo = "roma\namor\nramo\n";
    MotoreAnagrammi sorgente;
    sorgente.carica_vocabolario_ordinato_con_identita(testo);
    sorgente.associa_runtime_sillabe(runtime_per_vocabolario(testo, 3, 3));
    sorgente.imposta_sola_lettura(true);
    const auto identita = sorgente.identita_vocabolario_sha256();
    const auto verifica_stato = [&](const auto& m) {
        assert(m.esporta_vocabolario_testo() == testo && m.identita_vocabolario_sha256() == identita);
        assert(m.ha_runtime_sillabe() && m.runtime_sillabe()->voce(0).conteggi == std::vector<std::uint32_t>{3});
        assert(m.sola_lettura());
    };
    const auto originale = sorgente.avvia_comando_paginato("*");
    MotoreAnagrammi copia(sorgente);
    verifica_stato(copia);
    rifiuta<std::logic_error>([&] { copia.leggi_pagina_risultato(originale.id_snapshot, 0, 100); });
    assert(sorgente.leggi_pagina_risultato(originale.id_snapshot, 0, 100).count == 3);
    const auto prima_move = copia.avvia_comando_paginato("*");
    MotoreAnagrammi spostato(std::move(copia));
    verifica_stato(spostato);
    rifiuta<std::logic_error>([&] { spostato.leggi_pagina_risultato(prima_move.id_snapshot, 0, 100); });
    rifiuta<std::logic_error>([&] { copia.leggi_pagina_risultato(prima_move.id_snapshot, 0, 100); });
    assert(copia.vocabolario().empty() && !copia.ha_runtime_sillabe() && !copia.identita_vocabolario_sha256());
    assert(copia.avvia_comando_paginato("*").id_snapshot > prima_move.id_snapshot);

    MotoreAnagrammi destinazione;
    destinazione.avvia_comando_paginato("*");
    const auto precedente = destinazione.avvia_comando_paginato("*");
    destinazione = sorgente;
    verifica_stato(destinazione);
    rifiuta<std::logic_error>([&] { destinazione.leggi_pagina_risultato(precedente.id_snapshot, 0, 100); });
    assert(sorgente.leggi_pagina_risultato(originale.id_snapshot, 0, 100).count == 3);
    const auto dopo_copy = destinazione.avvia_comando_paginato("*");
    assert(dopo_copy.id_snapshot > precedente.id_snapshot);
    const auto prima_assegnazione_move = spostato.avvia_comando_paginato("*");
    destinazione = std::move(spostato);
    verifica_stato(destinazione);
    rifiuta<std::logic_error>([&] { destinazione.leggi_pagina_risultato(dopo_copy.id_snapshot, 0, 100); });
    rifiuta<std::logic_error>([&] { spostato.leggi_pagina_risultato(prima_assegnazione_move.id_snapshot, 0, 100); });
    assert(spostato.vocabolario().empty() && !spostato.ha_runtime_sillabe());
    assert(spostato.avvia_comando_paginato("*").id_snapshot > prima_assegnazione_move.id_snapshot);
    auto corrente = destinazione.avvia_comando_paginato("*");
    assert(corrente.id_snapshot > dopo_copy.id_snapshot);
    destinazione = destinazione;
    verifica_stato(destinazione);
    rifiuta<std::logic_error>([&] { destinazione.leggi_pagina_risultato(corrente.id_snapshot, 0, 100); });
    auto successivo = destinazione.avvia_comando_paginato("*");
    assert(successivo.id_snapshot > corrente.id_snapshot);
    destinazione = std::move(destinazione);
    verifica_stato(destinazione);
    rifiuta<std::logic_error>([&] { destinazione.leggi_pagina_risultato(successivo.id_snapshot, 0, 100); });
    assert(destinazione.avvia_comando_paginato("*").id_snapshot > successivo.id_snapshot);
}

void test_metadati_da_indici() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    using F = anagrammi::FiltroSillabe;
    const std::string testo = "roma\namor\nroma\nramo\ncitt\xc3\xa0\npi\xc3\xb9\npesca\np\xc3\xa9sca\n"
        "due parole\nvoce   [-interno]\n";
    const Words comandi = {"zzzz", "piu", u8"pi\u00f9", "roma", "romayx 4", "?om?", "*",
        "r*", "?o*", "&roma", "!xyz", "$roma", "due*", "voce*", u8"citt?", u8"*\u00e9sca", "%,10,20"};
    for (const bool personale : {false, true}) {
        MotoreAnagrammi motore;
        if (personale) motore.carica_vocabolario_da_testo(testo);
        else motore.carica_vocabolario_ordinato_con_identita(testo);
        motore.imposta_sola_lettura(!personale);
        for (const auto& comando : comandi) {
            confronta_risultati_comando(motore.esegui_comando(comando),
                ricerca_precedente(motore.vocabolario(), comando));
        }
        assert(motore.esegui_comando("  ").tipo == "vuoto");
        const auto prima = motore.vocabolario();
        const auto aggiunta = motore.esegui_comando("+ nuova");
        assert(aggiunta.parola_modificata == "nuova");
        assert(aggiunta.tipo == (personale ? "aggiunta" : "sola_lettura"));
        assert(aggiunta.vocabolario_modificato == personale && aggiunta.richiede_salvataggio == personale);
        assert(aggiunta.righe.empty() && aggiunta.parole_vocabolario.empty());
        const auto rimozione = motore.esegui_comando("- nuova");
        assert(rimozione.parola_modificata == "nuova");
        assert(rimozione.tipo == (personale ? "rimozione" : "sola_lettura"));
        assert(rimozione.vocabolario_modificato == personale && rimozione.richiede_salvataggio == personale);
        assert(motore.vocabolario() == prima);
    }

    MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, motore.numero_parole(), 3));
    for (const auto& comando : comandi) {
        const auto normale = motore.esegui_comando(comando);
        for (const auto& filtro : {F::esattamente(3), F::almeno(3), F::al_massimo(3), F::tra(2, 4)}) {
            confronta_risultati_comando(normale, motore.esegui_comando_con_filtro_sillabe(comando, filtro));
        }
    }

    // Correzione approvata: la riga collide con un'altra voce, non con il suo indice sorgente.
    const std::string collisione = "roma\nroma   [-yx]\nroma\n";
    motore.carica_vocabolario_ordinato_con_identita(collisione);
    motore.associa_runtime_sillabe(runtime_per_vocabolario(collisione, 3, 3));
    const auto vecchio = ricerca_precedente(motore.vocabolario(), "romayx 4");
    const auto nuovo = motore.esegui_comando("romayx 4");
    assert(vecchio.righe == nuovo.righe && nuovo.righe == (Words{"roma   [-yx]", "roma   [-yx]"}));
    assert(vecchio.parole_vocabolario == vecchio.righe);
    assert(nuovo.parole_vocabolario == (Words{"roma", "roma"}));
    auto atteso = vecchio;
    atteso.parole_vocabolario = nuovo.parole_vocabolario;
    confronta_risultati_comando(nuovo, atteso);
    confronta_risultati_comando(nuovo,
        motore.esegui_comando_con_filtro_sillabe("romayx 4", F::esattamente(3)));
    confronta_risultati_comando(motore.esegui_comando("*"), ricerca_precedente(motore.vocabolario(), "*"));
    MotoreAnagrammi personale;
    personale.carica_vocabolario_da_testo(collisione);
    const auto importato = personale.esegui_comando("romayx 4");
    assert(importato.righe == nuovo.righe && importato.parole_vocabolario == nuovo.parole_vocabolario);
    assert(anagrammi::e_ordinato_rimario(personale.vocabolario()));

    Words molte;
    for (std::size_t i = 0; i < 10000; ++i) molte.push_back("voce" + std::to_string(i));
    molte.push_back(molte.front());
    MotoreAnagrammi ampio(molte);
    const auto tutte = ampio.esegui_comando("*");
    assert(tutte.righe == molte && tutte.parole_vocabolario == molte);
    confronta_risultati_comando(tutte, ricerca_precedente(ampio.vocabolario(), "*"));
}

void test_budget_parole_casuali() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    using F = anagrammi::FiltroSillabe;
    static_assert(anagrammi::massimo_estrazioni_casuali == 100000);
    const std::string testo = "roma\namor\nroma\nsole\n";
    MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, 4, 3));
    const auto filtro = F::esattamente(3);

    for (const auto q : {1u, 10u, anagrammi::massimo_estrazioni_casuali}) {
        const auto comando = "^," + std::to_string(q) + ",4";
        for (const bool filtrato : {false, true}) {
            const auto risultato = filtrato
                ? motore.esegui_comando_con_filtro_sillabe(comando, filtro)
                : motore.esegui_comando(comando);
            assert(risultato.tipo == "ricerca" && risultato.righe.size() == q);
            assert(risultato.parole_vocabolario == risultato.righe);
            assert(risultato.footer == "- " + std::to_string(q) +
                " parole a caso - su 4 parole da 4 lettere");
            assert(!risultato.vocabolario_modificato && !risultato.richiede_salvataggio);
            for (const auto& parola : risultato.righe) {
                assert(parola == "roma" || parola == "amor" || parola == "sole");
            }
        }
    }

    const Words quantita_eccessive = {"100001", std::to_string(massimo), "-1"};
    for (const auto& q : quantita_eccessive) {
        // Anche il pool vuoto e la lunghezza malformata devono fermarsi al budget.
        for (const auto& lunghezza : Words{"4", "999", "non-numero"}) {
            for (const bool filtrato : {false, true}) {
                bool rifiutato = false;
                try {
                    const auto comando = "^," + q + "," + lunghezza;
                    if (filtrato) motore.esegui_comando_con_filtro_sillabe(comando, filtro);
                    else motore.esegui_comando(comando);
                } catch (const std::invalid_argument& errore) {
                    assert(std::string(errore.what()) ==
                        "Comando ^: massimo 100000 estrazioni per ricerca.");
                    rifiutato = true;
                }
                assert(rifiutato);
            }
        }
    }

    for (const bool filtrato : {false, true}) {
        const auto vuoto = filtrato
            ? motore.esegui_comando_con_filtro_sillabe("^,100000,999", filtro)
            : motore.esegui_comando("^,100000,999");
        assert(vuoto.righe.empty() && vuoto.parole_vocabolario.empty());
        assert(vuoto.footer == "- 0 corrispondenze -");
    }
    const auto escluso = motore.esegui_comando_con_filtro_sillabe("^,10,4", F::esattamente(42));
    assert(escluso.righe.empty() && escluso.footer == "- 0 corrispondenze -");
    assert(motore.esegui_comando("^,2junk,4").righe.size() == 2);
    assert(motore.esegui_comando("^,0,4").footer == "- 0 parole a caso - su 4 parole da 4 lettere");

    // Pool filtrato con due grafie uguali: due posizioni/pesi, reinserimento intatto.
    auto bytes = crea_fixture({
        {{3}, StatoSillabico::risolto, OrigineSillabica::automatico, 3},
        {{2}, StatoSillabico::risolto, OrigineSillabica::automatico, 2},
        {{3}, StatoSillabico::risolto, OrigineSillabica::automatico, 3},
        {{2}, StatoSillabico::risolto, OrigineSillabica::automatico, 2},
    });
    const auto hash = anagrammi::dettaglio::sha256(
        reinterpret_cast<const std::uint8_t*>(testo.data()), testo.size());
    std::copy(hash.begin(), hash.end(), bytes.begin() + 64);
    motore.associa_runtime_sillabe(RuntimeSillabe(std::move(bytes)));
    std::string footer;
    const auto estratti = anagrammi::dettaglio::parole_casuali_indicizzate(
        motore.vocabolario(), "^,100000,4", footer, motore.runtime_sillabe(), &filtro);
    assert(estratti.size() == 100000);
    assert(footer == "- 100000 parole a caso - su 2 parole da 4 lettere");
    for (const auto& candidato : estratti) {
        assert(candidato.indice_vocabolario == 0 || candidato.indice_vocabolario == 2);
        assert(candidato.lettere_non_usate.empty());
    }
    assert(motore.vocabolario() == (Words{"roma", "amor", "roma", "sole"}));
}

void test_anagrammi_filtrati_motore() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    using F = anagrammi::FiltroSillabe;
    using S = StatoSillabico;
    using O = OrigineSillabica;
    const std::string testo = "nota\nroma\namor\nroma\nramo\nnon\n";
    const Words parole = {"nota", "roma", "amor", "roma", "ramo", "non"};
    const Words anagrammi_attesi = {"roma", "amor", "roma", "ramo"};
    const Words residui = {"roma   [-yx]", "amor   [-yx]", "roma   [-yx]", "ramo   [-yx]"};
    MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    assert(motore.esegui_comando("roma").righe == anagrammi_attesi);
    assert(motore.esegui_comando("romayx 4").righe == residui);
    rifiuta<std::logic_error>([&] {
        motore.cerca_anagrammi_con_filtro_sillabe("roma", 4, F::esattamente(3));
    });
    MotoreAnagrammi senza_identita(parole);
    rifiuta<std::logic_error>([&] {
        senza_identita.cerca_anagrammi_con_filtro_sillabe("roma", 4, F::esattamente(3));
    });

    const Words comandi = {"roma", "romayx 4", "?om?", "r*", "?o*", "&roma", "!roma", "$roma", "^,1,3", "%,10,20", ""};
    Words testi_prima;
    std::vector<anagrammi::RisultatoComando> risultati_prima;
    for (const auto& comando : comandi) {
        testi_prima.push_back(motore.esegui_comando_testo(comando));
        risultati_prima.push_back(motore.esegui_comando(comando));
    }
    auto bytes = crea_fixture({
        {{2}, S::risolto, O::automatico, 2},
        {{3, 4}, S::ambiguo, O::automatico, 9},
        {{2}, S::solo_stima, O::automatico, 0},
        {{5}, S::risolto, O::automatico, 5},
        {{4}, S::risolto, O::automatico, 4},
        {{}, S::conflitto, O::automatico, 3}});
    const auto hash = anagrammi::dettaglio::sha256(
        reinterpret_cast<const std::uint8_t*>(testo.data()), testo.size());
    std::copy(hash.begin(), hash.end(), bytes.begin() + 64);
    motore.associa_runtime_sillabe(RuntimeSillabe(std::move(bytes)));
    const auto identita = motore.identita_vocabolario_sha256();
    const auto* runtime = motore.runtime_sillabe();
    const auto cerca = [&](const F& filtro) {
        return motore.cerca_anagrammi_con_filtro_sillabe("roma", 4, filtro);
    };
    assert((cerca(F::esattamente(2)) == Words{"amor"}));
    assert((cerca(F::esattamente(3)) == Words{"roma"}));
    assert((cerca(F::esattamente(4)) == Words{"roma", "ramo"}));
    assert((cerca(F::esattamente(5)) == Words{"roma"}));
    assert((cerca(F::almeno(4)) == Words{"roma", "roma", "ramo"}));
    assert((cerca(F::al_massimo(3)) == Words{"roma", "amor"}));
    const auto ambiguo = cerca(F::tra(3, 4));
    assert((ambiguo == Words{"roma", "ramo"}));
    assert(std::count(ambiguo.begin(), ambiguo.end(), "roma") == 1);
    assert(cerca(F::tra(2, 5)) == anagrammi_attesi);
    assert(cerca(F::esattamente(8)).empty());
    assert(motore.cerca_anagrammi_con_filtro_sillabe("zzz", 3, F::almeno(1)).empty());

    assert((motore.cerca_anagrammi_con_filtro_sillabe("romayx", 4, F::tra(3, 4)) ==
        Words{"roma   [-yx]", "ramo   [-yx]"}));
    assert((motore.cerca_anagrammi_con_filtro_sillabe("romayx", 4, F::al_massimo(3)) ==
        Words{"roma   [-yx]", "amor   [-yx]"}));
    assert(motore.cerca_anagrammi_con_filtro_sillabe("romayx", 4, F::tra(2, 5)) == residui);
    assert((motore.cerca_anagrammi_con_filtro_sillabe("romaa", 4, F::esattamente(4)) ==
        Words{"roma   [-a]", "ramo   [-a]"}));
    assert((motore.cerca_anagrammi_con_filtro_sillabe("  ROMAYX  ", 4, F::tra(3, 4)) ==
        Words{"roma   [-yx]", "ramo   [-yx]"}));
    motore.imposta_sola_lettura(true);
    assert((cerca(F::esattamente(5)) == Words{"roma"}));
    motore.imposta_sola_lettura(false);

    // Il filtro e' per chiamata: nessun effetto su stato o API precedenti.
    assert(motore.vocabolario() == parole);
    assert(motore.identita_vocabolario_sha256() == identita);
    assert(motore.runtime_sillabe() == runtime);
    assert(anagrammi::cerca_anagrammi(motore.vocabolario(), "roma", 4) == anagrammi_attesi);
    assert(anagrammi::cerca_anagrammi(motore.vocabolario(), "romayx", 4) == residui);
    for (std::size_t i = 0; i < comandi.size(); ++i) {
        assert(motore.esegui_comando_testo(comandi[i]) == testi_prima[i]);
        const auto dopo = motore.esegui_comando(comandi[i]);
        const auto& prima = risultati_prima[i];
        assert(dopo.tipo == prima.tipo && dopo.righe == prima.righe);
        assert(dopo.parole_vocabolario == prima.parole_vocabolario);
        assert(dopo.footer == prima.footer && dopo.messaggio == prima.messaggio);
        assert(dopo.parola_modificata == prima.parola_modificata);
        assert(dopo.vocabolario_modificato == prima.vocabolario_modificato);
        assert(dopo.richiede_salvataggio == prima.richiede_salvataggio);
    }
    MotoreAnagrammi riferimento;
    riferimento.carica_vocabolario_ordinato_da_testo(testo);
    assert(motore.esegui_comando_testo("+ mora") == riferimento.esegui_comando_testo("+ mora"));
    assert(motore.vocabolario() == riferimento.vocabolario());
    rifiuta<std::logic_error>([&] { cerca(F::esattamente(3)); });
    assert(motore.esegui_comando_testo("- mora") == riferimento.esegui_comando_testo("- mora"));
    assert(motore.vocabolario() == riferimento.vocabolario());
}

void test_comandi_filtrati_motore() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    using F = anagrammi::FiltroSillabe;
    using S = StatoSillabico;
    using O = OrigineSillabica;
    const Words parole = {"nota", "roma", "amor", "roma", "ramo", "non", "rara",
        u8"citt\u00e0", "citto", "ssa", "sasso", "sasa", "a", "b"};
    const std::vector<std::vector<std::uint32_t>> conteggi = {
        {2}, {3, 4}, {2}, {5}, {4}, {}, {2}, {2}, {3}, {1}, {2}, {3}, {1}, {2}};
    std::string testo;
    std::vector<VoceSillabica> voci;
    for (std::size_t i = 0; i < parole.size(); ++i) {
        testo += parole[i] + '\n';
        voci.push_back({conteggi[i], conteggi[i].empty() ? S::conflitto :
            conteggi[i].size() > 1 ? S::ambiguo : S::risolto,
            O::automatico, 99});
    }
    MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    for (const auto& comando : Words{"roma", "?om?", "r*", "?o*", "&roma", "!on", "$roma", "^,3,4"}) {
        rifiuta<std::logic_error>([&] { motore.esegui_comando_con_filtro_sillabe(comando, F::esattamente(3)); });
    }
    auto bytes = crea_fixture(voci);
    const auto hash = anagrammi::dettaglio::sha256(
        reinterpret_cast<const std::uint8_t*>(testo.data()), testo.size());
    std::copy(hash.begin(), hash.end(), bytes.begin() + 64);
    motore.associa_runtime_sillabe(RuntimeSillabe(std::move(bytes)));
    const auto identita = motore.identita_vocabolario_sha256();
    const auto* runtime = motore.runtime_sillabe();

    struct Caso {
        std::string comando;
        std::vector<std::size_t> indici;
        std::string residui;
    };
    const std::vector<Caso> casi = {
        {"roma", {1, 2, 3, 4}, ""}, {"romayx 4", {1, 2, 3, 4}, "yx"},
        {"?om?", {1, 3}, ""}, {"r*", {1, 3, 4, 6}, ""},
        {"*ma", {1, 3}, ""}, {"*om*", {1, 3}, ""},
        {"?o*", {0, 1, 3, 5}, ""}, {"r?m?", {1, 3, 4}, ""},
        {"r**?m?*", {1, 3, 4}, ""}, {"*roma*", {1, 3}, ""},
        {"&roma", {1, 2, 3, 4}, ""}, {"!on", {6, 7, 9, 11, 12, 13}, ""},
        {"$roma", {1, 2, 3, 4, 12}, ""}, {"&ss", {9, 10, 11}, ""},
        {"&aa", {6, 11}, ""}, {"$ssa", {9, 12}, ""}, {"$ssaa", {9, 11, 12}, ""},
        {u8"citt?", {7, 8}, ""}, {u8"*tt?", {7, 8}, ""},
        {u8"*\u00e0", {7}, ""}, {u8"citt\u00e0*", {7}, ""},
        {u8"*citt\u00e0?", {}, ""}, {"zzz*", {}, ""},
        {"*", {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}, ""},
        {"*?**", {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}, ""}};
    const auto parole_per_indici = [&](const std::vector<std::size_t>& indici) {
        Words risultato;
        for (auto indice : indici) {
            risultato.push_back(parole.at(indice));
        }
        return risultato;
    };
    const auto formatta_attesi = [](Words attesi, const std::string& residui) {
        if (!residui.empty()) {
            for (auto& parola : attesi) {
                parola += "   [-" + residui + "]";
            }
        }
        return attesi;
    };
    const std::vector<F> filtri = {
        F::esattamente(3), F::almeno(4), F::al_massimo(2), F::tra(2, 4), F::esattamente(99)};
    for (const auto& caso : casi) {
        const Words basi = parole_per_indici(caso.indici);
        const auto normale = motore.esegui_comando(caso.comando);
        assert(normale.righe == formatta_attesi(basi, caso.residui));
        assert(normale.parole_vocabolario == basi);
        assert(normale.footer == "- " + std::to_string(basi.size()) + " corrispondenze -");
        const auto storico = anagrammi::esegui_ricerca(parole, caso.comando);
        assert(storico.risultati == normale.righe && storico.footer == normale.footer);
        const auto indicizzato = anagrammi::dettaglio::esegui_ricerca_indicizzata(parole, caso.comando);
        assert(indicizzato.candidati.size() == caso.indici.size());
        for (std::size_t i = 0; i < caso.indici.size(); ++i) {
            assert(indicizzato.candidati[i].indice_vocabolario == caso.indici[i]);
            assert(indicizzato.candidati[i].lettere_non_usate == caso.residui);
        }
        for (const auto& filtro : filtri) {
            std::vector<std::size_t> indici_attesi;
            for (auto indice : caso.indici) {
                if (std::any_of(conteggi[indice].begin(), conteggi[indice].end(), [&](auto conteggio) {
                    return conteggio >= filtro.minimo() && conteggio <= filtro.massimo();
                })) {
                    indici_attesi.push_back(indice);
                }
            }
            const auto attesi = parole_per_indici(indici_attesi);
            const auto risultato = motore.esegui_comando_con_filtro_sillabe(caso.comando, filtro);
            assert(risultato.tipo == "ricerca" && risultato.messaggio.empty());
            assert(risultato.righe == formatta_attesi(attesi, caso.residui));
            assert(risultato.parole_vocabolario == attesi);
            assert(risultato.footer == "- " + std::to_string(attesi.size()) + " corrispondenze -");
            assert(!risultato.vocabolario_modificato && !risultato.richiede_salvataggio);
            assert(risultato.parola_modificata.empty());
            const auto indicizzati = anagrammi::dettaglio::esegui_ricerca_indicizzata(
                parole, caso.comando, runtime, &filtro).candidati;
            assert(indicizzati.size() == indici_attesi.size());
            for (std::size_t i = 0; i < indici_attesi.size(); ++i) {
                assert(indicizzati[i].indice_vocabolario == indici_attesi[i]);
                assert(indicizzati[i].lettere_non_usate == caso.residui);
            }
        }
    }
    const auto ambiguo = motore.esegui_comando_con_filtro_sillabe("?om?", F::tra(3, 4));
    assert((ambiguo.righe == Words{"roma"}));
    assert((motore.esegui_comando_con_filtro_sillabe("?om?", F::esattamente(5)).righe == Words{"roma"}));
    assert((motore.esegui_comando_con_filtro_sillabe("?om?", F::almeno(3)).righe == Words{"roma", "roma"}));
    for (const auto& filtro : filtri) {
        assert(motore.cerca_anagrammi_con_filtro_sillabe("romayx", 4, filtro) ==
            motore.esegui_comando_con_filtro_sillabe("romayx 4", filtro).righe);
    }
    assert((motore.esegui_comando_con_filtro_sillabe("CITTA\xcc\x80?*", F::esattamente(2)).righe.empty()));
    assert((motore.esegui_comando_con_filtro_sillabe("  CITT?  ", F::esattamente(2)).righe == Words{u8"citt\u00e0"}));

    // Il bacino viene filtrato prima del campionamento con reinserimento.
    for (const auto& filtro : filtri) {
        const auto risultato = motore.esegui_comando_con_filtro_sillabe("^,40,4", filtro);
        std::vector<std::size_t> bacino;
        for (auto indice : std::vector<std::size_t>{0, 1, 2, 3, 4, 6, 11}) {
            if (std::any_of(conteggi[indice].begin(), conteggi[indice].end(), [&](auto conteggio) {
                return conteggio >= filtro.minimo() && conteggio <= filtro.massimo();
            })) {
                bacino.push_back(indice);
            }
        }
        const auto ammesse = parole_per_indici(bacino);
        if (bacino.empty()) {
            assert(risultato.righe.empty() && risultato.footer == "- 0 corrispondenze -");
        } else {
            assert(risultato.righe.size() == 40 && risultato.parole_vocabolario == risultato.righe);
            for (const auto& parola : risultato.righe) {
                assert(std::find(ammesse.begin(), ammesse.end(), parola) != ammesse.end());
            }
            assert(risultato.footer == "- 40 parole a caso - su " +
                std::to_string(bacino.size()) + " parole da 4 lettere");
            auto distinte = risultato.righe;
            std::sort(distinte.begin(), distinte.end());
            distinte.erase(std::unique(distinte.begin(), distinte.end()), distinte.end());
            assert(distinte.size() < risultato.righe.size());
        }
    }
    const auto due_indici = F::almeno(3);
    std::string footer;
    const auto estratti = anagrammi::dettaglio::parole_casuali_indicizzate(
        parole, "^,40,4", footer, runtime, &due_indici);
    assert(estratti.size() == 40 && footer == "- 40 parole a caso - su 4 parole da 4 lettere");
    for (const auto& candidato : estratti) {
        assert(candidato.indice_vocabolario == 1 || candidato.indice_vocabolario == 3 ||
            candidato.indice_vocabolario == 4 ||
            candidato.indice_vocabolario == 11);
        assert(candidato.lettere_non_usate.empty());
    }
    const auto singolo = motore.esegui_comando_con_filtro_sillabe("^,8,4", F::esattamente(5));
    assert(singolo.righe == Words(8, "roma"));
    assert(singolo.footer == "- 8 parole a caso - su 1 parole da 4 lettere");
    const auto zero = motore.esegui_comando_con_filtro_sillabe("^,0,4", F::esattamente(5));
    assert(zero.righe.empty() && zero.footer == "- 0 parole a caso - su 1 parole da 4 lettere");
    const auto casuale_normale = motore.esegui_comando("^,40,4");
    assert(casuale_normale.righe.size() == 40);
    assert(casuale_normale.footer == "- 40 parole a caso - su 7 parole da 4 lettere");
    assert(casuale_normale.parole_vocabolario == casuale_normale.righe);

    for (const auto& comando : Words{"", "  "}) {
        assert(motore.esegui_comando_con_filtro_sillabe(comando, F::esattamente(3)).tipo == "vuoto");
    }
    for (const auto& comando : Words{"%,10,20", "%*?&!$^"}) {
        const auto risultato = motore.esegui_comando_con_filtro_sillabe(comando, F::esattamente(3));
        assert(risultato.righe.empty() && risultato.parole_vocabolario.empty());
        assert(risultato.footer == "Comando non disponibile.");
    }
    assert(motore.esegui_comando_con_filtro_sillabe("^", F::esattamente(3)).footer ==
        "Uso corretto: ^,quante,caratteri  esempio: ^,10,8");
    rifiuta<std::invalid_argument>([&] {
        motore.esegui_comando_con_filtro_sillabe("^,errore,4", F::esattamente(3));
    });
    for (bool sola_lettura : {false, true}) {
        motore.imposta_sola_lettura(sola_lettura);
        for (const auto& comando : Words{"+ nuova", "- roma", "+ *", "- ?om?"}) {
            rifiuta<std::invalid_argument>([&] {
                motore.esegui_comando_con_filtro_sillabe(comando, F::esattamente(3));
            });
        }
        assert(motore.vocabolario() == parole);
        assert(motore.identita_vocabolario_sha256() == identita && motore.runtime_sillabe() == runtime);
        assert(motore.numero_parole() == parole.size() && motore.sola_lettura() == sola_lettura);
    }

    // Simboli misti: stessa precedenza del parser, non nuove combinazioni logiche.
    MotoreAnagrammi simboli;
    const std::string testo_simboli = "a&\na!\na$\na^\na?\n";
    simboli.carica_vocabolario_ordinato_con_identita(testo_simboli);
    simboli.associa_runtime_sillabe(runtime_per_vocabolario(testo_simboli, 5, 2));
    for (const auto& caso : std::vector<std::pair<std::string, Words>>{
        {"?&", {"a&"}}, {"*&", {"a&"}}, {"*!", {"a!"}}, {"*$", {"a$"}},
        {"*^", {"a^"}}, {"*?", {"a&", "a!", "a$", "a^", "a?"}},
        {"&!", {"a!"}}, {"!$", {"a&", "a!", "a^", "a?"}}, {"$^", {}}}) {
        assert(simboli.esegui_comando(caso.first).righe == caso.second);
        assert(simboli.esegui_comando_con_filtro_sillabe(caso.first, F::esattamente(2)).righe == caso.second);
        assert(simboli.esegui_comando_con_filtro_sillabe(caso.first, F::esattamente(3)).righe.empty());
    }
}

void test_applica_modifiche_sola_lettura() {
    using anagrammi::Words;
    const std::string testo = "extra\nala\nafa\n";
    anagrammi::MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, 3));
    motore.imposta_sola_lettura(true);
    const Words parole = motore.vocabolario();
    const auto identita = motore.identita_vocabolario_sha256();
    const auto* runtime = motore.runtime_sillabe();
    const auto conteggi = runtime->voce(0).conteggi;

    motore.applica_modifiche(Words{"extra"}, Words{"acca", "era"});
    assert(motore.sola_lettura());
    assert((motore.vocabolario() == Words{"extra", "ala", "afa"}));
    assert(motore.vocabolario() == parole);
    assert(motore.numero_parole() == 3);
    assert(motore.identita_vocabolario_sha256() == identita);
    assert(motore.ha_runtime_sillabe() && motore.runtime_sillabe() == runtime);
    assert(runtime->vocabolario_sha256() == *identita);
    assert(runtime->numero_grafie() == motore.numero_parole());
    assert(runtime->voce(0).conteggi == conteggi);

    motore.imposta_sola_lettura(false);
    motore.applica_modifiche(Words{"extra"}, Words{"acca", "era"});
    assert((motore.vocabolario() == Words{"afa", "ala", "acca", "era"}));
    assert(motore.numero_parole() == 4);
    assert(anagrammi::e_ordinato_rimario(motore.vocabolario()));
    assert(!motore.identita_vocabolario_sha256());
    assert(!motore.ha_runtime_sillabe() && motore.runtime_sillabe() == nullptr);
}

void test_associazione_runtime_motore() {
    using anagrammi::MotoreAnagrammi;
    using anagrammi::Words;
    static_assert(std::is_nothrow_move_constructible<MotoreAnagrammi>::value);
    static_assert(std::is_nothrow_move_assignable<MotoreAnagrammi>::value);
    static_assert(std::is_nothrow_swappable<std::optional<RuntimeSillabe>>::value);
    static_assert(std::is_same<decltype(std::declval<const MotoreAnagrammi&>().runtime_sillabe()),
                               const RuntimeSillabe*>::value);

    const std::string testo = u8"roma\namor\nramo\ncitt\u00e0\n";
    const Words parole = {"roma", "amor", "ramo", u8"citt\u00e0"};
    const std::string hash = "7127490e1888c658b2e752caf5213ac05562715642c4ccacd7a859b5900fb790";
    const auto senza_metadati = [](const MotoreAnagrammi& motore) {
        assert(!motore.identita_vocabolario_sha256());
        assert(!motore.ha_runtime_sillabe());
        assert(motore.runtime_sillabe() == nullptr);
    };
    MotoreAnagrammi vuoto;
    senza_metadati(vuoto);
    MotoreAnagrammi normale(parole);
    normale.imposta_sola_lettura(true);
    senza_metadati(normale);
    rifiuta<std::invalid_argument>([&] {
        normale.associa_runtime_sillabe(runtime_per_vocabolario(testo, parole.size()));
    });
    senza_metadati(normale);
    assert(normale.vocabolario() == parole && normale.sola_lettura());

    MotoreAnagrammi motore;
    motore.carica_vocabolario_ordinato_con_identita(testo);
    assert(motore.vocabolario() == parole);
    assert(motore.identita_vocabolario_sha256() == hash);
    assert(!motore.ha_runtime_sillabe());
    assert(motore.runtime_sillabe() == nullptr);
    const std::string altro_testo = u8"mora\namor\nramo\ncitt\u00e0\n";
    const auto rifiuta_hash = [&] {
        rifiuta<std::invalid_argument>([&] {
            motore.associa_runtime_sillabe(runtime_per_vocabolario(altro_testo, parole.size()));
        });
    };
    rifiuta_hash();
    assert(motore.vocabolario() == parole && motore.identita_vocabolario_sha256() == hash);
    assert(!motore.ha_runtime_sillabe());

    const Words comandi = {"roma", "romaa 4", "?om?", "r*", "?o*", "&roma", "!roma", "$roma", "%,10,20", ""};
    std::vector<anagrammi::RisultatoComando> prima;
    for (const auto& comando : comandi) {
        prima.push_back(motore.esegui_comando(comando));
    }
    // Conteggi volutamente estranei alla ricerca: nessun filtro deve essere attivo.
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, parole.size()));
    assert(motore.ha_runtime_sillabe());
    const auto* runtime_precedente = motore.runtime_sillabe();
    assert(runtime_precedente->vocabolario_sha256() == hash);
    assert(runtime_precedente->numero_grafie() == parole.size());
    assert(runtime_precedente->voce(0).conteggi == std::vector<std::uint32_t>{42});
    for (std::size_t i = 0; i < comandi.size(); ++i) {
        const auto dopo = motore.esegui_comando(comandi[i]);
        const auto& atteso = prima[i];
        assert(dopo.tipo == atteso.tipo && dopo.righe == atteso.righe);
        assert(dopo.parole_vocabolario == atteso.parole_vocabolario);
        assert(dopo.footer == atteso.footer && dopo.messaggio == atteso.messaggio);
        assert(dopo.parola_modificata == atteso.parola_modificata);
        assert(dopo.vocabolario_modificato == atteso.vocabolario_modificato);
        assert(dopo.richiede_salvataggio == atteso.richiede_salvataggio);
        assert(motore.esegui_comando_testo(comandi[i]) == anagrammi::risultato_in_testo(atteso));
    }
    assert((motore.esegui_comando("roma").righe == Words{"roma", "amor", "ramo"}));
    assert((anagrammi::cerca_anagrammi(motore.vocabolario(), "roma", 4) == Words{"roma", "amor", "ramo"}));

    const auto invariato = [&] {
        assert(motore.vocabolario() == parole);
        assert(motore.identita_vocabolario_sha256() == hash);
        assert(motore.runtime_sillabe() == runtime_precedente);
        assert(motore.runtime_sillabe()->voce(0).conteggi == std::vector<std::uint32_t>{42});
    };
    rifiuta_hash();
    invariato();
    rifiuta<std::invalid_argument>([&] {
        motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, parole.size() + 1));
    });
    invariato();
    for (const auto& input : Words{"ROMA\n", "roma", "roma\r\n", "roma\n\n", "\xef\xbb\xbfroma\n"}) {
        rifiuta<std::invalid_argument>([&] { motore.carica_vocabolario_ordinato_con_identita(input); });
        invariato();
    }
    motore.imposta_sola_lettura(true);
    assert(!motore.aggiungi_parola("mora"));
    assert(!motore.rimuovi_parola("roma"));
    assert(!motore.esegui_comando("+ mora").vocabolario_modificato);
    assert(!motore.esegui_comando("- roma").vocabolario_modificato);
    rifiuta<std::invalid_argument>([&] { motore.carica_vocabolario_ordinato_con_identita("ROMA\n"); });
    invariato();
    assert(motore.sola_lettura());
    motore.imposta_sola_lettura(false);
    invariato();

    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, parole.size(), 7));
    assert(motore.runtime_sillabe()->voce(0).conteggi == std::vector<std::uint32_t>{7});
    motore.carica_vocabolario_ordinato_con_identita(testo);
    assert(motore.identita_vocabolario_sha256() == hash && !motore.ha_runtime_sillabe());
    motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, parole.size()));
    motore.carica_vocabolario_ordinato_con_identita(altro_testo);
    assert(motore.identita_vocabolario_sha256() != hash && !motore.ha_runtime_sillabe());
    assert(motore.vocabolario()[0] == "mora");

    const auto ripristina = [&] {
        motore.carica_vocabolario_ordinato_con_identita(testo);
        motore.associa_runtime_sillabe(runtime_per_vocabolario(testo, parole.size()));
    };
    ripristina();
    motore.carica_vocabolario_ordinato_da_testo(testo);
    senza_metadati(motore);
    assert(motore.vocabolario() == parole);
    ripristina();
    motore.carica_vocabolario_da_testo(testo);
    senza_metadati(motore);
    assert(anagrammi::e_ordinato_rimario(motore.vocabolario()));
    ripristina();
    motore.sostituisci_vocabolario(parole);
    senza_metadati(motore);
    assert(motore.vocabolario() == parole);
    ripristina();
    motore.applica_modifiche(Words{"roma"}, Words{"mora"});
    senza_metadati(motore);
    assert(anagrammi::e_ordinato_rimario(motore.vocabolario()));
    assert(std::find(motore.vocabolario().begin(), motore.vocabolario().end(), "roma") == motore.vocabolario().end());
    ripristina();
    motore.applica_modifiche({}, {});
    senza_metadati(motore);
    ripristina();
    assert(motore.aggiungi_parola("mora"));
    senza_metadati(motore);
    ripristina();
    assert(!motore.aggiungi_parola("roma"));
    invariato();
    ripristina();
    assert(!motore.aggiungi_parola(""));
    invariato();
    ripristina();
    assert(motore.rimuovi_parola("roma"));
    senza_metadati(motore);
    ripristina();
    assert(!motore.rimuovi_parola("assente"));
    invariato();
    ripristina();
    assert(!motore.esegui_comando("+ roma").vocabolario_modificato);
    invariato();
    ripristina();
    assert(motore.esegui_comando("- roma").vocabolario_modificato);
    senza_metadati(motore);

    // Gli argomenti possono riferirsi ai metadati che il mutatore invalidera'.
    ripristina();
    motore.carica_vocabolario_da_testo(*motore.identita_vocabolario_sha256());
    senza_metadati(motore);
    assert(motore.vocabolario() == Words{hash});
    ripristina();
    motore.carica_vocabolario_ordinato_da_testo(motore.runtime_sillabe()->vocabolario_sha256());
    senza_metadati(motore);
    assert(motore.vocabolario() == Words{hash});
    ripristina();
    assert(motore.aggiungi_parola(*motore.identita_vocabolario_sha256()));
    senza_metadati(motore);
    assert(std::find(motore.vocabolario().begin(), motore.vocabolario().end(), hash) != motore.vocabolario().end());
    ripristina();
    assert(!motore.rimuovi_parola(motore.runtime_sillabe()->vocabolario_sha256()));
    invariato();

    MotoreAnagrammi disordinato(Words{"extra", "ala", "afa"});
    assert(!disordinato.aggiungi_parola("ala"));
    assert((disordinato.vocabolario() == Words{"extra", "ala", "afa"}));
    senza_metadati(disordinato);

    ripristina();
    MotoreAnagrammi copia(motore);
    assert(copia.vocabolario() == parole && copia.identita_vocabolario_sha256() == hash);
    assert(copia.ha_runtime_sillabe() && copia.runtime_sillabe() != motore.runtime_sillabe());
    MotoreAnagrammi assegnato;
    assegnato = motore;
    assert(assegnato.vocabolario() == parole && assegnato.identita_vocabolario_sha256() == hash);
    assert(assegnato.runtime_sillabe()->voce(0).conteggi == std::vector<std::uint32_t>{42});
    motore = motore;
    motore = std::move(motore);
    assert(motore.vocabolario() == parole && motore.identita_vocabolario_sha256() == hash);
    assert(motore.ha_runtime_sillabe());
    MotoreAnagrammi spostato(std::move(copia));
    assert(spostato.vocabolario() == parole && spostato.identita_vocabolario_sha256() == hash);
    assert(spostato.ha_runtime_sillabe());
    senza_metadati(copia);
    assert(copia.vocabolario().empty());
    assegnato = std::move(spostato);
    assert(assegnato.vocabolario() == parole && assegnato.identita_vocabolario_sha256() == hash);
    assert(assegnato.ha_runtime_sillabe());
    senza_metadati(spostato);
    assert(spostato.vocabolario().empty());
    assegnato = normale;
    senza_metadati(assegnato);
    assert(assegnato.vocabolario() == normale.vocabolario() && assegnato.sola_lettura());

    vuoto.carica_vocabolario_ordinato_con_identita("");
    assert(vuoto.identita_vocabolario_sha256());
    vuoto.associa_runtime_sillabe(runtime_per_vocabolario("", 0));
    assert(vuoto.ha_runtime_sillabe() && vuoto.runtime_sillabe()->numero_grafie() == 0);
}

std::vector<VoceSillabica> voci_fixture() {
    using S = StatoSillabico;
    using O = OrigineSillabica;
    return {{{2}, S::risolto, O::automatico, 2},
            {{2, 3}, S::ambiguo, O::curatela_ufficiale, 1},
            {{}, S::conflitto, O::automatico, 7},
            {{}, S::da_rivedere, O::curatela_ufficiale, 0},
            {{}, S::escludi, O::curatela_ufficiale, 4},
            {{3}, S::stima_corroborata, O::automatico, 2},
            {{1000}, S::solo_stima, O::automatico, 999},
            {{massimo}, S::risolto, O::curatela_ufficiale, massimo},
            {{2}, S::risolto, O::automatico, 2},
            {{}, S::da_rivedere, O::automatico, 0}};
}

void verifica_fixture(const RuntimeSillabe& runtime) {
    const auto voci = voci_fixture();
    assert(runtime.numero_grafie() == 10);
    assert(runtime.numero_conteggi_distinti() == 4);
    assert(runtime.numero_membership() == 7);
    assert(runtime.vocabolario_sha256() == std::string(64, '1'));
    assert(runtime.annotazioni_sha256() == std::string(64, '2'));
    assert((runtime.indici_compatibili(2) == std::vector<std::size_t>{0, 1, 8}));
    assert((runtime.indici_compatibili(3) == std::vector<std::size_t>{1, 5}));
    assert((runtime.indici_compatibili(1000) == std::vector<std::size_t>{6}));
    assert((runtime.indici_compatibili(massimo) == std::vector<std::size_t>{7}));
    assert(runtime.indici_compatibili(4).empty());
    for (std::size_t i = 0; i < voci.size(); ++i) {
        const auto voce = runtime.voce(i);
        assert(voce.conteggi == voci[i].conteggi);
        assert(voce.stato == voci[i].stato);
        assert(voce.origine == voci[i].origine);
        assert(voce.algoritmo == voci[i].algoritmo);
        assert(voce.esclusione_in_attesa() == (i == 4));
        for (std::uint64_t numero : {2ULL, 3ULL, 4ULL, 1000ULL, 4294967295ULL}) {
            assert(runtime.compatibile(i, numero) ==
                (std::find(voce.conteggi.begin(), voce.conteggi.end(), numero) != voce.conteggi.end()));
        }
    }
    rifiuta<std::out_of_range>([&] { runtime.voce(10); });
    rifiuta<std::out_of_range>([&] { runtime.compatibile(10, 2); });
    rifiuta<std::out_of_range>([&] { runtime.voce(std::numeric_limits<std::size_t>::max()); });
    for (auto numero : {0ULL, 4294967296ULL, 18446744073709551615ULL}) {
        rifiuta<std::invalid_argument>([&] { runtime.compatibile(0, numero); });
        rifiuta<std::invalid_argument>([&] { runtime.indici_compatibili(numero); });
    }
}

void test_sha256() {
    using anagrammi::dettaglio::sha256;
    using anagrammi::dettaglio::sha256_esadecimale;
    const auto controlla = [&](const std::string& testo, const std::string& atteso) {
        const Bytes bytes(testo.begin(), testo.end());
        assert(sha256_esadecimale(sha256(bytes.data(), bytes.size())) == atteso);
    };
    assert(sha256_esadecimale(sha256(nullptr, 0)) ==
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    controlla("abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    controlla("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    controlla("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmn"
              "hijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
        "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
    controlla(std::string(1000000, 'a'), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    rifiuta<std::invalid_argument>([&] { sha256(nullptr, 1); });
}

void test_validi() {
    using S = StatoSillabico;
    using O = OrigineSillabica;
    const RuntimeSillabe vuoto(crea_fixture({}));
    assert(vuoto.numero_grafie() == 0 && vuoto.numero_conteggi_distinti() == 0 && vuoto.numero_membership() == 0);
    assert(vuoto.indici_compatibili(2).empty());
    rifiuta<std::out_of_range>([&] { vuoto.voce(0); });
    const RuntimeSillabe senza_conteggi(crea_fixture({{{}, S::conflitto, O::automatico, 3}}));
    assert(senza_conteggi.numero_conteggi_distinti() == 0);
    assert(!senza_conteggi.compatibile(0, 3));
    assert(senza_conteggi.voce(0).algoritmo == 3);
    assert(senza_conteggi.voce(0).conteggi.empty());
    const RuntimeSillabe singolo(crea_fixture({{{1}, S::risolto, O::automatico, 0}}));
    assert(singolo.compatibile(0, 1));
    assert((singolo.indici_compatibili(1) == std::vector<std::size_t>{0}));
    const RuntimeSillabe ambiguo(crea_fixture({{{1, 2, 7, massimo}, S::ambiguo, O::automatico, 3}}));
    assert((ambiguo.voce(0).conteggi == std::vector<std::uint32_t>{1, 2, 7, massimo}));
    assert(!ambiguo.compatibile(0, 3));
    const RuntimeSillabe multiplo(crea_fixture(std::vector<VoceSillabica>(8, {{7}, S::risolto, O::automatico, 7})));
    assert(multiplo.indici_compatibili(7).size() == 8);
    assert(multiplo.compatibile(7, 7));
    std::vector<VoceSillabica> molte;
    for (std::uint32_t i = 1; i <= 70; ++i) {
        molte.push_back({{i}, S::risolto, O::automatico, i});
    }
    const RuntimeSillabe oltre_63(crea_fixture(molte));
    assert(oltre_63.numero_conteggi_distinti() == 70);
    assert(oltre_63.compatibile(69, 70));
    assert((oltre_63.indici_compatibili(64) == std::vector<std::size_t>{63}));
    assert((oltre_63.voce(69).conteggi == std::vector<std::uint32_t>{70}));
    auto bytes = crea_fixture(voci_fixture());
    const RuntimeSillabe proprietario(bytes);
    std::fill(bytes.begin(), bytes.end(), 0);
    verifica_fixture(proprietario);
    auto copia = proprietario;
    auto spostato = std::move(copia);
    verifica_fixture(spostato);
}

void test_invalidi() {
    const auto valido = crea_fixture(voci_fixture());
    // Ricalcola il checksum: i test strutturali non devono fallire solo per l'hash.
    const auto altera = [&](auto modifica) {
        auto bytes = valido;
        modifica(bytes);
        checksum(bytes);
        rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(bytes); });
    };
    altera([](Bytes& b) { b[0] ^= 1; });
    altera([](Bytes& b) { b[7] = 1; });
    altera([](Bytes& b) { scrivi_le(b, 8, 2, 2); });
    altera([](Bytes& b) { scrivi_le(b, 10, 191, 2); });
    altera([](Bytes& b) { b[12] = 1; });
    altera([](Bytes& b) { b[191] = 1; });
    altera([](Bytes& b) { scrivi_le(b, 28, 3, 4); });
    altera([](Bytes& b) { scrivi_le(b, 32, 193, 8); });
    altera([](Bytes& b) { scrivi_le(b, 40, directory + 1, 8); });
    altera([](Bytes& b) { scrivi_le(b, 48, bitmap - 1, 8); });
    altera([](Bytes& b) { scrivi_le(b, 56, b.size() + 1, 8); });
    altera([](Bytes& b) { scrivi_le(b, 24, 3, 4); });
    altera([](Bytes& b) { scrivi_le(b, 24, 41, 4); });
    altera([](Bytes& b) { scrivi_le(b, 24, 6, 4); });
    altera([](Bytes& b) { scrivi_le(b, 24, 8, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory, 0, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory + 16, 2, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory + 16, 1, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory + 4, 0, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory + 4, 11, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory + 4, 2, 4); });
    altera([](Bytes& b) { scrivi_le(b, directory + 8, bitmap + 1, 8); });
    altera([](Bytes& b) { scrivi_le(b, directory + 24, bitmap, 8); });
    altera([](Bytes& b) { scrivi_le(b, directory + 8, 0xffffffffffffffffULL, 8); });
    altera([](Bytes& b) { b[bitmap + 1] |= 0x80; });
    altera([](Bytes& b) { b[192 + 4] = 0; });
    altera([](Bytes& b) { b[192 + 4] = 8; });
    altera([](Bytes& b) { b[192 + 5] = 0; });
    altera([](Bytes& b) { b[192 + 5] = 3; });
    altera([](Bytes& b) { b[192 + 6] = 1; });
    altera([](Bytes& b) { b[192 + 7] = 1; });
    for (std::uint8_t stato = 1; stato <= 7; ++stato) {
        altera([&](Bytes& b) { b[192 + (stato == 6 ? 0 : stato <= 3 ? 2 : 0) * 8 + 4] = stato; });
    }
    for (std::uint8_t stato = 1; stato <= 3; ++stato) {
        altera([&](Bytes& b) { b[192 + 8 + 4] = stato; });
    }
    for (std::size_t indice : {2u, 5u, 6u}) {
        altera([&](Bytes& b) { b[192 + indice * 8 + 5] = 2; });
    }
    altera([](Bytes& b) { scrivi_le(b, 16, massimo, 4); });
    altera([](Bytes& b) { scrivi_le(b, 20, massimo, 4); });
    altera([](Bytes& b) { scrivi_le(b, 48, 0xffffffffffffffffULL, 8); });
    altera([](Bytes& b) { scrivi_le(b, 56, 0xffffffffffffffffULL, 8); });
    auto corrotto = valido;
    corrotto[192] ^= 1;
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(corrotto); });
    corrotto = valido;
    corrotto[128] ^= 1;
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(corrotto); });
    for (std::size_t lunghezza = 0; lunghezza < valido.size(); ++lunghezza) {
        rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(Bytes(valido.begin(), valido.begin() + lunghezza)); });
    }
    auto extra = valido;
    extra.push_back(0);
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(extra); });
    // Layout canonico enorme: rifiuto prima di allocare cardinalita/directory, anche in WASM32.
    auto enorme = crea_fixture({});
    scrivi_le(enorme, 16, massimo, 4);
    scrivi_le(enorme, 28, (std::uint64_t{massimo} + 7) / 8, 4);
    const auto directory_enorme = 192 + std::uint64_t{massimo} * 8;
    scrivi_le(enorme, 40, directory_enorme, 8);
    scrivi_le(enorme, 48, directory_enorme, 8);
    scrivi_le(enorme, 56, directory_enorme, 8);
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(enorme); });
}

void test_filtri() {
    using F = anagrammi::FiltroSillabe;
    using S = StatoSillabico;
    using O = OrigineSillabica;
    const std::vector<VoceSillabica> voci = {
        {{3, 4}, S::ambiguo, O::automatico, 8},
        {{2, 4}, S::ambiguo, O::curatela_ufficiale, 3},
        {{3}, S::risolto, O::automatico, 3},
        {{7}, S::stima_corroborata, O::automatico, 7},
        {{1000}, S::solo_stima, O::automatico, 1000},
        {{}, S::conflitto, O::automatico, 3},
        {{}, S::da_rivedere, O::curatela_ufficiale, 3},
        {{}, S::escludi, O::curatela_ufficiale, 3},
        {{massimo}, S::risolto, O::curatela_ufficiale, massimo},
        {{2, 3, 7, 1000}, S::ambiguo, O::automatico, 0},
        {{4}, S::solo_stima, O::automatico, 4},
        {{2}, S::risolto, O::automatico, 2}};
    const RuntimeSillabe runtime(crea_fixture(voci));
    const auto controlla = [&](const F& filtro, const std::vector<std::size_t>& attesi) {
        const auto indici = runtime.indici_compatibili(filtro);
        assert(indici == attesi);
        assert(std::is_sorted(indici.begin(), indici.end()));
        assert(std::adjacent_find(indici.begin(), indici.end()) == indici.end());
        for (std::size_t i = 0; i < voci.size(); ++i) {
            assert(runtime.compatibile(i, filtro) == (std::find(attesi.begin(), attesi.end(), i) != attesi.end()));
        }
    };
    controlla(F::esattamente(3), {0, 2, 9});
    controlla(F::esattamente(4), {0, 1, 10});
    controlla(F::esattamente(5), {});
    controlla(F::almeno(3), {0, 1, 2, 3, 4, 8, 9, 10});
    controlla(F::almeno(4), {0, 1, 3, 4, 8, 9, 10});
    controlla(F::almeno(5), {3, 4, 8, 9});
    controlla(F::al_massimo(3), {0, 1, 2, 9, 11});
    controlla(F::al_massimo(2), {1, 9, 11});
    controlla(F::al_massimo(1), {});
    controlla(F::tra(2, 3), {0, 1, 2, 9, 11});
    controlla(F::tra(4, 6), {0, 1, 10});
    controlla(F::tra(5, 7), {3, 9});
    controlla(F::tra(3, 100), {0, 1, 2, 3, 9, 10});
    controlla(F::tra(8, 999), {});
    controlla(F::tra(1000, massimo), {4, 8, 9});
    controlla(F::esattamente(massimo), {8});
    controlla(F::almeno(massimo), {8});
    controlla(F::al_massimo(massimo), {0, 1, 2, 3, 4, 8, 9, 10, 11});
    controlla(F::tra(massimo, massimo), {8});

    // Confronto indipendente sui conteggi sorgente, inclusi buchi e limiti della directory.
    const std::vector<std::uint64_t> estremi = {1, 2, 3, 4, 5, 6, 7, 8, 999, 1000, 1001, massimo - 1, massimo};
    for (auto minimo : estremi) {
        for (auto massimo_filtro : estremi) {
            if (minimo > massimo_filtro) {
                continue;
            }
            std::vector<std::size_t> attesi;
            for (std::size_t i = 0; i < voci.size(); ++i) {
                if (std::any_of(voci[i].conteggi.begin(), voci[i].conteggi.end(), [&](std::uint32_t n) {
                    return minimo <= n && n <= massimo_filtro;
                })) {
                    attesi.push_back(i);
                }
            }
            controlla(F::tra(minimo, massimo_filtro), attesi);
        }
        assert(runtime.indici_compatibili(minimo) == runtime.indici_compatibili(F::esattamente(minimo)));
        for (std::size_t i = 0; i < voci.size(); ++i) {
            assert(runtime.compatibile(i, minimo) == runtime.compatibile(i, F::esattamente(minimo)));
        }
    }
    const RuntimeSillabe dispersi(crea_fixture({{{2}, S::risolto, O::automatico, 2},
        {{3, 7}, S::ambiguo, O::automatico, 3}, {{1000}, S::solo_stima, O::automatico, 1000}}));
    assert((dispersi.indici_compatibili(F::tra(3, 100)) == std::vector<std::size_t>{1}));
    assert(!dispersi.compatibile(0, F::tra(3, 100)));
    assert(dispersi.compatibile(1, F::tra(3, 100)));
    const RuntimeSillabe vuoto(crea_fixture({}));
    const RuntimeSillabe senza_conteggi(crea_fixture({{{}, S::conflitto, O::automatico, 3}}));
    for (const auto& filtro : {F::esattamente(3), F::almeno(1), F::al_massimo(massimo), F::tra(2, 4)}) {
        assert(vuoto.indici_compatibili(filtro).empty());
        assert(senza_conteggi.indici_compatibili(filtro).empty());
        assert(!senza_conteggi.compatibile(0, filtro));
    }
    rifiuta<std::out_of_range>([&] { runtime.compatibile(voci.size(), F::almeno(1)); });
    rifiuta<std::out_of_range>([&] { vuoto.compatibile(0, F::tra(2, 4)); });
    for (auto n : {0ULL, 4294967296ULL, 18446744073709551615ULL}) {
        rifiuta<std::invalid_argument>([&] { F::esattamente(n); });
        rifiuta<std::invalid_argument>([&] { F::almeno(n); });
        rifiuta<std::invalid_argument>([&] { F::al_massimo(n); });
        rifiuta<std::invalid_argument>([&] { F::tra(n, massimo); });
        rifiuta<std::invalid_argument>([&] { F::tra(1, n); });
    }
    rifiuta<std::invalid_argument>([&] { F::tra(4, 3); });
}

void test_hash_attesi() {
    const auto bytes = crea_fixture(voci_fixture());
    VerificheRuntimeSillabe verifiche;
    verifiche.vocabolario_sha256 = std::string(64, '1');
    verifiche.annotazioni_sha256 = std::string(64, '2');
    verifiche.numero_grafie = 10;
    verifiche.artifact_sha256 = anagrammi::dettaglio::sha256_esadecimale(
        anagrammi::dettaglio::sha256(bytes.data(), bytes.size()));
    verifica_fixture(RuntimeSillabe(bytes, verifiche));
    auto errate = verifiche;
    errate.vocabolario_sha256 = std::string(64, '3');
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(bytes, errate); });
    errate = verifiche;
    errate.annotazioni_sha256 = std::string(64, '3');
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(bytes, errate); });
    errate = verifiche;
    errate.artifact_sha256 = std::string(64, '0');
    rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(bytes, errate); });
    for (std::uint64_t n : {0ULL, 11ULL, 4294967296ULL, 18446744073709551615ULL}) {
        errate = verifiche;
        errate.numero_grafie = n;
        rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(bytes, errate); });
    }
    for (const auto& hash : {std::string(""), std::string(63, '1'), std::string(65, '1'),
                             std::string(64, 'A'), std::string(64, 'z')}) {
        errate = verifiche;
        errate.vocabolario_sha256 = hash;
        rifiuta<std::invalid_argument>([&] { RuntimeSillabe runtime(bytes, errate); });
    }
}

void test_filtra_candidati_anagramma() {
    using F = anagrammi::FiltroSillabe;
    using S = StatoSillabico;
    using O = OrigineSillabica;
    using anagrammi::Words;
    using anagrammi::dettaglio::CandidatiAnagrammi;
    using anagrammi::dettaglio::cerca_anagrammi_indicizzati;
    using anagrammi::dettaglio::filtra_candidati_per_sillabe;
    using anagrammi::dettaglio::formatta_anagrammi;

    const Words vocabolario = {"nota", "roma", "amor", "roma", "ramo", "non"};
    const RuntimeSillabe runtime(crea_fixture({
        {{2}, S::risolto, O::automatico, 2},
        {{3, 4}, S::ambiguo, O::automatico, 9},
        {{2}, S::solo_stima, O::automatico, 0},
        {{5}, S::risolto, O::automatico, 5},
        {{4}, S::risolto, O::automatico, 4},
        {{}, S::conflitto, O::automatico, 3}}));
    const auto confronta = [](const CandidatiAnagrammi& effettivi, const CandidatiAnagrammi& attesi) {
        assert(effettivi.size() == attesi.size());
        for (std::size_t i = 0; i < attesi.size(); ++i) {
            assert(effettivi[i].indice_vocabolario == attesi[i].indice_vocabolario);
            assert(effettivi[i].lettere_non_usate == attesi[i].lettere_non_usate);
        }
    };
    const auto candidati = cerca_anagrammi_indicizzati(vocabolario, "romayx", 4);
    confronta(candidati, {{1, "yx"}, {2, "yx"}, {3, "yx"}, {4, "yx"}});
    confronta(filtra_candidati_per_sillabe(candidati, runtime, F::esattamente(3)), {{1, "yx"}});
    confronta(filtra_candidati_per_sillabe(candidati, runtime, F::esattamente(4)), {{1, "yx"}, {4, "yx"}});
    confronta(filtra_candidati_per_sillabe(candidati, runtime, F::almeno(4)), {{1, "yx"}, {3, "yx"}, {4, "yx"}});
    confronta(filtra_candidati_per_sillabe(candidati, runtime, F::al_massimo(3)), {{1, "yx"}, {2, "yx"}});
    confronta(filtra_candidati_per_sillabe(candidati, runtime, F::tra(3, 4)), {{1, "yx"}, {4, "yx"}});
    assert(filtra_candidati_per_sillabe(candidati, runtime, F::esattamente(8)).empty());
    assert(filtra_candidati_per_sillabe({}, runtime, F::almeno(1)).empty());

    // Stessa grafia, due posizioni: soltanto l'indice 1 soddisfa esattamente 3.
    assert(vocabolario[1] == vocabolario[3]);
    const auto filtrati = filtra_candidati_per_sillabe(candidati, runtime, F::tra(3, 4));
    assert((formatta_anagrammi(vocabolario, filtrati) == Words{"roma   [-yx]", "ramo   [-yx]"}));

    // Ordine non crescente e residui diversi: niente ordinamento o ricostruzione testuale.
    const CandidatiAnagrammi manuali = {{4, "z"}, {1, "yx"}, {5, ""}, {3, "xy"}, {2, u8"\u00e8"}};
    confronta(filtra_candidati_per_sillabe(manuali, runtime, F::tra(3, 4)), {{4, "z"}, {1, "yx"}});
    const auto tutti = filtra_candidati_per_sillabe(manuali, runtime, F::almeno(1));
    confronta(tutti, {{4, "z"}, {1, "yx"}, {3, "xy"}, {2, u8"\u00e8"}});
    assert((formatta_anagrammi(vocabolario, tutti) ==
        Words{"ramo   [-z]", "roma   [-yx]", "roma   [-xy]", u8"amor   [-\u00e8]"}));
    const CandidatiAnagrammi ripetuti = {{1, "a"}, {1, "b"}};
    confronta(filtra_candidati_per_sillabe(ripetuti, runtime, F::almeno(3)), ripetuti);

    rifiuta<std::out_of_range>([&] {
        filtra_candidati_per_sillabe({{1, "yx"}, {6, ""}}, runtime, F::esattamente(8));
    });
    rifiuta<std::out_of_range>([&] {
        filtra_candidati_per_sillabe({{std::numeric_limits<std::size_t>::max(), ""}}, runtime, F::almeno(1));
    });

    // Il filtro non muta i candidati e non attiva alcun nuovo comportamento nell'API esistente.
    const Words attese = {"roma   [-yx]", "amor   [-yx]", "roma   [-yx]", "ramo   [-yx]"};
    confronta(candidati, {{1, "yx"}, {2, "yx"}, {3, "yx"}, {4, "yx"}});
    confronta(manuali, {{4, "z"}, {1, "yx"}, {5, ""}, {3, "xy"}, {2, u8"\u00e8"}});
    assert(formatta_anagrammi(vocabolario, candidati) == attese);
    assert(anagrammi::cerca_anagrammi(vocabolario, "romayx", 4) == attese);
    assert((anagrammi::cerca_anagrammi(vocabolario, "roma", 4) == Words{"roma", "amor", "roma", "ramo"}));
}

void test_profilo_incrementale_exception_safety() {
    using namespace anagrammi;
    using F = FiltroSillabe;
    assert(dettaglio::codifica_stima_sillabe(0) == 0);
    assert(dettaglio::codifica_stima_sillabe(massimo - 1) == massimo - 1);
    rifiuta<std::overflow_error>([] { dettaglio::codifica_stima_sillabe(massimo); });
    if constexpr (sizeof(std::size_t) > sizeof(std::uint32_t)) {
        rifiuta<std::overflow_error>([] { dettaglio::codifica_stima_sillabe(std::size_t(massimo) + 1); });
    }
    // Il numero di allocazioni per UNA voce non cresce col numero di voci esistenti.
    const auto costo_inserimento = [](std::size_t n) {
        ProfiloSillabePersonale profilo(Words(n, "casa"));
        allocazioni_test::conteggio = 0; allocazioni_test::misura = true;
        profilo.inserisci(n / 2, "parolastranissima");
        allocazioni_test::misura = false;
        const auto costo = allocazioni_test::conteggio;
        assert(profilo.compatibile(n / 2, F::esattamente(7)));
        assert(profilo.compatibile(n / 2 + 1, F::esattamente(2)));
        profilo.rimuovi(n / 2);
        assert(profilo.compatibile(n / 2, F::esattamente(2)));
        return costo;
    };
    assert(costo_inserimento(8) == costo_inserimento(8192));

    for (bool ordinato : {false, true}) {
        MotoreAnagrammi base;
        if (ordinato) base.carica_vocabolario_da_testo("regia\ncasa\nbrrr\ncasa\n");
        else base.sostituisci_vocabolario({"regia", "casa", "brrr", "casa"});
        base.prepara_sillabe_personali();
        const auto originale = base.vocabolario();
        const auto snapshot = base.avvia_comando_paginato_con_filtro_sillabe("*", F::almeno(1));
        assert(!base.aggiungi_parola("CASA"));
        assert(!base.rimuovi_parola("inesistente"));
        assert(base.vocabolario() == originale && base.ha_profilo_sillabe_personale());
        assert(base.leggi_pagina_risultato(snapshot.id_snapshot, 0, 100).count == snapshot.totale);
        // Ogni allocazione C++ fallibile viene interrotta a turno, anche nel riordino raro.
        for (int operazione = 0; operazione < 3; ++operazione) {
            bool riuscita = false;
            for (std::ptrdiff_t budget = 0; budget < 500 && !riuscita; ++budget) {
                auto motore = base;
                const auto prima = motore.avvia_comando_paginato_con_filtro_sillabe("*", F::almeno(1));
                allocazioni_test::budget = budget;
                bool fallita = false;
                try {
                    if (operazione == 0) assert(motore.aggiungi_parola("parolastranissima"));
                    if (operazione == 1) assert(motore.rimuovi_parola("casa"));
                    if (operazione == 2) motore.applica_modifiche({"casa"}, {"parolastranissima"});
                    riuscita = true;
                } catch (const std::bad_alloc&) { fallita = true; }
                allocazioni_test::budget = -1;
                assert(motore.ha_profilo_sillabe_personale());
                if (fallita) {
                    assert(motore.vocabolario() == originale);
                    assert(motore.leggi_pagina_risultato(prima.id_snapshot, 0, 100).count == prima.totale);
                } else if (operazione == 0) {
                    assert((motore.esegui_comando_con_filtro_sillabe("*", F::esattamente(7)).righe == Words{"parolastranissima"}));
                    assert(e_ordinato_rimario(motore.vocabolario()));
                } else {
                    assert(std::count(motore.vocabolario().begin(), motore.vocabolario().end(), "casa") == 0);
                }
                const auto atteso = motore.vocabolario();
                ProfiloSillabePersonale riferimento(atteso);
                for (const auto& filtro : {F::esattamente(2), F::almeno(3), F::al_massimo(2), F::tra(2, 7)}) {
                    Words righe;
                    for (std::size_t i = 0; i < atteso.size(); ++i) if (riferimento.compatibile(i, filtro)) righe.push_back(atteso[i]);
                    assert(motore.esegui_comando_con_filtro_sillabe("*", filtro).righe == righe);
                }
            }
            assert(riuscita);
        }
    }
}

void test_profilo_sillabe_personale() {
    using namespace anagrammi;
    using F = FiltroSillabe;
    const std::string testo = u8"suada\nregia\ncitt\u00e0\ncasa\n";
    auto bytes = crea_fixture({
        {{}, StatoSillabico::escludi, OrigineSillabica::curatela_ufficiale, 2},
        {{2, 3}, StatoSillabico::ambiguo, OrigineSillabica::curatela_ufficiale, 2},
        {{8}, StatoSillabico::risolto, OrigineSillabica::curatela_ufficiale, 2},
        {{2}, StatoSillabico::risolto, OrigineSillabica::automatico, 2}});
    const auto sha = dettaglio::sha256(reinterpret_cast<const std::uint8_t*>(testo.data()), testo.size());
    std::copy(sha.begin(), sha.end(), bytes.begin() + 64);
    MotoreAnagrammi ufficiale;
    ufficiale.carica_vocabolario_ordinato_con_identita(testo);
    ufficiale.associa_runtime_sillabe(RuntimeSillabe(bytes));
    assert(!ufficiale.aggiungi_parola("regia"));
    assert(!ufficiale.rimuovi_parola("inesistente"));
    assert(ufficiale.ha_runtime_sillabe() && ufficiale.identita_vocabolario_sha256());
    ufficiale.imposta_sola_lettura(true);
    MotoreAnagrammi personale(ufficiale.vocabolario());
    personale.prepara_sillabe_personali_da_ufficiale(ufficiale);
    assert(!personale.ha_runtime_sillabe() && !personale.identita_vocabolario_sha256());
    assert(personale.ha_profilo_sillabe_personale());
    const auto immutato = personale.avvia_comando_paginato_con_filtro_sillabe("*", F::almeno(1));
    assert(!personale.aggiungi_parola("REGIA") && !personale.rimuovi_parola("inesistente"));
    assert(personale.leggi_pagina_risultato(immutato.id_snapshot, 0, 100).count == immutato.totale);
    for (const auto& f : {F::esattamente(2), F::almeno(3), F::al_massimo(2), F::tra(2, 8)}) {
        assert(personale.esegui_comando_con_filtro_sillabe("*", f).righe ==
            ufficiale.esegui_comando_con_filtro_sillabe("*", f).righe);
    }
    const auto parole = [](MotoreAnagrammi& m, const F& f) {
        return m.esegui_comando_con_filtro_sillabe("*", f).parole_vocabolario;
    };
    const auto contiene = [&](MotoreAnagrammi& m, const F& f, const std::string& word) {
        const auto r = parole(m, f); return std::find(r.begin(), r.end(), word) != r.end();
    };
    assert(personale.rimuovi_parola("casa"));
    assert(contiene(personale, F::esattamente(8), u8"citt\u00e0"));
    assert(personale.aggiungi_parola("parolastranissima"));
    assert(conta_sillabe("parolastranissima") == 7);
    assert(contiene(personale, F::esattamente(7), "parolastranissima"));
    assert(personale.rimuovi_parola("regia"));
    assert(!contiene(personale, F::esattamente(3), "regia"));
    assert(personale.aggiungi_parola("REGIA"));
    assert(contiene(personale, F::esattamente(2), "regia"));
    assert(contiene(personale, F::esattamente(3), "regia"));
    assert(!contiene(personale, F::almeno(1), "suada"));
    assert(personale.aggiungi_parola("brrr"));
    assert(conta_sillabe("brrr") == 0 && !contiene(personale, F::almeno(1), "brrr"));
    assert(e_ordinato_rimario(personale.vocabolario()));
    personale.applica_modifiche({"regia"}, {"regia", "casa"});
    assert(contiene(personale, F::esattamente(3), "regia"));
    const auto prima = personale.esporta_vocabolario_testo();
    rifiuta<std::invalid_argument>([&] { personale.esegui_comando_con_filtro_sillabe("+ nuova", F::almeno(1)); });
    assert(personale.esporta_vocabolario_testo() == prima);
    MotoreAnagrammi importato;
    importato.carica_vocabolario_da_testo(u8"CASA\ncitta\u0300\nregia\ncitt\u00e0\nsuada\nparolastranissima\nbrrr\n");
    importato.prepara_sillabe_personali_da_ufficiale(ufficiale);
    assert((parole(importato, F::esattamente(8)) == Words{u8"citt\u00e0", u8"citt\u00e0"}));
    assert(contiene(importato, F::esattamente(7), "parolastranissima"));
    assert(!contiene(importato, F::almeno(1), "suada"));
    auto copia = importato;
    MotoreAnagrammi spostato(std::move(copia));
    assert(parole(spostato, F::almeno(1)) == parole(importato, F::almeno(1)));
    MotoreAnagrammi solo_stima;
    solo_stima.carica_vocabolario_da_testo("casa\nparolastranissima\nbrrr\n");
    solo_stima.prepara_sillabe_personali();
    assert((parole(solo_stima, F::esattamente(7)) == Words{"parolastranissima"}));
    assert((parole(solo_stima, F::al_massimo(2)) == Words{"casa"}));
    rifiuta<std::logic_error>([&] { solo_stima.prepara_sillabe_personali_da_ufficiale(personale); });
    rifiuta<std::invalid_argument>([&] { importato.associa_runtime_sillabe(RuntimeSillabe(bytes)); });
    // Lo snapshot ufficiale resta immutato, anche se la fonte condivisa sopravvive a modifiche della sorgente.
    assert(ufficiale.ha_runtime_sillabe() && ufficiale.esporta_vocabolario_testo() == testo);
    ufficiale.imposta_sola_lettura(false); ufficiale.rimuovi_parola("regia");
    assert(contiene(importato, F::esattamente(3), "regia"));
    const auto snapshot = importato.avvia_comando_paginato_con_filtro_sillabe("*", F::almeno(1));
    assert(importato.leggi_pagina_risultato(snapshot.id_snapshot, 0, 2).count == 2);
    assert(!importato.esegui_comando_con_filtro_sillabe("^,10,4", F::esattamente(2)).righe.empty());
}

} // namespace

int main(int argc, char* argv[]) {
    test_profilo_incrementale_exception_safety();
    test_profilo_sillabe_personale();
    test_pagine_dimensioni_e_output();
    test_pagine_filtri_e_casuali();
    test_pagine_invalidazione_e_modifiche();
    test_pagine_copy_move();
    test_metadati_da_indici();
    test_budget_parole_casuali();
    test_comandi_filtrati_motore();
    test_anagrammi_filtrati_motore();
    test_applica_modifiche_sola_lettura();
    test_associazione_runtime_motore();
    test_sha256();
    test_validi();
    test_invalidi();
    test_filtri();
    test_hash_attesi();
    test_filtra_candidati_anagramma();
    if (argc == 2) {
        std::ifstream file(argv[1], std::ios::binary);
        assert(file.is_open());
        const Bytes bytes{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
        assert(bytes == crea_fixture(voci_fixture()));
        verifica_fixture(RuntimeSillabe(bytes));
        std::cout << "Conformita Python/C++ verificata byte-per-byte e tramite tutte le query.\n";
    }
    std::cout << "Test runtime sillabico superati (" << rifiuti_verificati << " rifiuti verificati).\n";
}
