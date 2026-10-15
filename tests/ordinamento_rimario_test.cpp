#include "../core/ordinamento_rimario.hpp"

#include <cassert>
#include <iostream>

int main() {
    using anagrammi::Words;

    assert(anagrammi::rimario_less("afa", "ala"));
    assert(anagrammi::rimario_less("afa", "acca"));
    assert(anagrammi::rimario_less("caramella", "gargamella"));

    Words riferimento = {"extra", "elba", "era", "anta", "arma", "asia", "aria", "ala", "afa"};
    anagrammi::ordina_rimario(riferimento);
    assert((riferimento == Words{"afa", "ala", "aria", "asia", "arma", "anta", "era", "elba", "extra"}));

    Words accenti = {"andrò", "andrà", "ANDRÀ"};
    anagrammi::ordina_rimario(accenti);
    assert((accenti == Words{"ANDRÀ", "andrà", "andrò"}));

    Words senza_vocali = {"xyz", "casa", "rhythm", "afa"};
    anagrammi::ordina_rimario(senza_vocali);
    assert((senza_vocali == Words{"afa", "casa", "rhythm", "xyz"}));
    assert(anagrammi::e_ordinato_rimario(senza_vocali));

    Words estratto_legacy = {"pecchia", "iperpnea", "assemblea", "semblea", "effettua"};
    anagrammi::ordina_rimario(estratto_legacy);
    assert((estratto_legacy == Words{"effettua", "semblea", "assemblea", "iperpnea", "pecchia"}));

    std::cout << "Test ordinamento rimario superati.\n";
    return 0;
}
