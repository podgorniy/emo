// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * "Suggest a passphrase" (ui.md §12.5): random English
 * words, ASCII by design, chosen with `crypto.getRandomValues`. A chunk of
 * its own, fetched on the first tap only (performance.md §3.3).
 *
 * The words are the EFF Large Wordlist for passphrases by the Electronic
 * Frontier Foundation (https://www.eff.org/dice), CC BY 3.0 US
 * (https://creativecommons.org/licenses/by/3.0/us/), as shipped with
 * KeePassXC (7772 words), with the words about pain, illness, death,
 * violence, distress and the body's flaws taken out (804, by stem) — this is
 * an app about how the body feels: 6968 words, about 12.8 bits each.
 */

/** Five words: about 64 bits, the "strong" band of the meter */
export const SUGGESTED_WORDS = 5;

export const WORDS: readonly string[] = [
  "abacus abdomen abide abiding ability ablaze able abrasion abrasive abreast " +
  "abridge abroad abruptly absence absentee absently absinthe absolute " +
  "absolve abstain abstract absurd accent acclaim acclimate accompany account " +
  "accuracy accurate accustom acetone acorn acquaint acquire acre acrobat " +
  "acronym acting action activate activator active activism activist activity " +
  "actress acts acutely acuteness aeration aerobics aerosol aerospace afar " +
  "affair affected affecting affection affidavit affiliate affirm affix " +
  "afflicted afford affront aflame afloat afoot afterglow afterlife aftermath " +
  "aftermost afternoon aged ageless agency agenda agent aggregate aghast " +
  "agile agility aging agnostic agreeable agreeably agreeing agreement " +
  "aground ahead ahoy aide aids aim ajar alabaster albatross album alfalfa " +
  "algebra algorithm alias alibi alienable aliens alike alive alkaline " +
  "alkalize almanac almighty almost aloe aloft aloha alongside aloof alphabet " +
  "alright although altitude alto aluminum alumni always amaretto amaze " +
  "amazingly amber ambiance ambiguity ambiguous ambition ambitious ambulance " +
  "ambush amendable amendment amends amenity amiable amicably amid amigo " +
  "amino amiss ammonia ammonium amnesty amniotic among amount ample amplifier " +
  "amplify amply amuck amulet amusable amused amusement amuser amusing " +
  "anaconda anaerobic anatomist anatomy anchor anchovy ancient android anemia " +
  "anemic aneurism anew angelfish angelic angled angler angles angling " +
  "angular animal animate animating animation animator anime animosity ankle " +
  "annex annotate announcer annually annuity anointer another answering " +
  "antarctic anteater antelope antennae anthem anthill anthology antibody " +
  "antics antidote antihero antiquely antiques antiviral antivirus antler " +
  "antonym antsy anvil anybody anyhow anymore anyone anyplace anything " +
  "anytime anyway anywhere aorta apache apostle appealing appear appease " +
  "appeasing appendage appendix appetite appetizer applaud applause apple " +
  "appliance applicant applied apply appointee appraisal appraiser apprehend " +
  "approach approval approve apricot april apron aptitude aptly aqua aqueduct " +
  "arbitrary arbitrate ardently area arena arguable arguably argue arise " +
  "armadillo armband armchair armed armful armhole arming armoire armored " +
  "armory armrest army aroma arose around arousal arrange array arrival " +
  "arrive arrogance arrogant art ascend ascension ascent ascertain ashes ashy " +
  "aside askew asleep asparagus aspect aspirate aspire aspirin astonish " +
  "astound astride astrology astronaut astronomy astute atlantic atlas atom " +
  "atonable atop atrium atrocious atrophy attach attain attendant attendee " +
  "attention attentive attest attic attire attitude attractor attribute " +
  "atypical auction audacious audacity audible audibly audience audio " +
  "audition augmented august authentic author autism autistic autograph " +
  "automaker automated automatic autopilot available avalanche avatar avenge " +
  "avenging avenue aversion avert aviation aviator avid avoid await awaken " +
  "awhile awning awoke awry axis babble babbling babied baboon backache " +
  "backboard backboned backdrop backed backer backfield backfire backhand " +
  "backing backlands backlash backless backlight backlit backlog backpack " +
  "backpedal backrest backroom backshift backside backslid backspace backspin " +
  "backstage backtalk backtrack backup backwash backwater backyard bacon " +
  "bacteria bacterium baffle baffling bagel bagful bagged baggie bagginess " +
  "bagging baggy bagpipe baguette baked bakery bakeshop baking balance " +
  "balancing balcony balmy balsamic bamboo banana banish banister banjo " +
  "bankable bankbook banked banker banking banknote bankroll banner bannister " +
  "banshee banter barbecue barbed barbell barber barcode barge bargraph " +
  "barista baritone barley barmaid barman barn barometer barrack barracuda " +
  "barrel barrette barricade barrier barstool bartender barterer bash " +
  "basically basics basil basin basis basket batboy batch bath baton bats " +
  "battalion battered battering battery batting bauble bazooka blabber " +
  "bladder blade blanching blandness blank blaspheme blasphemy blatancy " +
  "blatantly blazer bleep blemish blend bless blighted bling blinked blinker " +
  "blinking blinks blip blissful blitz blizzard blob blog bloomers blooper " +
  "blouse blubber bluff bluish blunt blurb blurred blurry blurt blush " +
  "blustery boaster boasting boat bobbed bobbing bobble bobcat bobsled " +
  "bobtail bodacious body bogged boggle bok bolster bolt bonanza bonded " +
  "bonding bondless boned bonehead boneless bonelike boney bonfire bonnet " +
  "bonsai bonus bony boogeyman boogieman book boondocks booted booth bootie " +
  "booting bootlace bootleg boots boozy borax borough borrower borrowing boss " +
  "botanical botanist botany botch both bottle bottling bottom bounce " +
  "bouncing bouncy bounding boundless bountiful bovine boxcar boxer boxing " +
  "boxlike boxy breach breath breeches breeching breeder breeding breeze " +
  "breezy brethren brewery brewing briar brick bride bridged brigade bright " +
  "brilliant brim bring brink brisket briskly briskness bristle brittle " +
  "broadband broadcast broaden broadly broadness broadside broadways broiler " +
  "broiling broker bronchial bronco bronze bronzing brook broom brought " +
  "browbeat brownnose browse browsing brunch brunette brunt brush brussels " +
  "bubble bubbling bubbly buccaneer bucked bucket buckle buckshot buckskin " +
  "bucktooth buckwheat buddhism buddhist budding buddy budget buffalo buffed " +
  "buffer buffing buffoon bulb bulge bulginess bulgur bulk bulldog bulldozer " +
  "bullfight bullfrog bullhorn bullion bullish bullpen bullring bullseye " +
  "bullwhip bunch bundle bungee bunkbed bunkhouse bunkmate bunny bunt busboy " +
  "bush busily busload busybody buzz cabana cabbage cabbie cabdriver cable " +
  "caboose cache cackle cacti cactus caddie caddy cadet cadillac cadmium cage " +
  "cahoots cake calamari calamity calcium calculate calculus caliber " +
  "calibrate calm caloric calorie calzone camcorder cameo camera camisole " +
  "camper campfire camping campsite canal canary cancel candied candle candy " +
  "cane canine canister cannabis canned canning cannon cannot canola canon " +
  "canopener canopy canteen canyon capable capably capacity cape capillary " +
  "capital capitol capped capricorn capsize capsule caption captivate captive " +
  "captivity capture caramel carat caravan carbon cardboard carded cardiac " +
  "cardigan cardinal cardstock carefully caregiver caress caretaker cargo " +
  "caring carless carload carmaker carnation carnival carnivore carol " +
  "carpenter carpentry carpool carport carried carrousel carry cartel " +
  "cartload carton cartoon cartridge cartwheel carve carving carwash cascade " +
  "case cash casing casino cassette casually catacomb catalog catalyst " +
  "catalyze catapult cataract catatonic catcall catchable catcher catching " +
  "catchy caterer catering catfight catfish cathedral cathouse catlike catnap " +
  "catnip catsup cattail cattishly cattle catty catwalk caucasian caucus " +
  "causal causation cause causing cauterize caution cautious cavalier cavalry " +
  "caviar cavity cedar celery celestial celibacy celibate celtic cement " +
  "census ceramics ceremony certainly certainty certified certify cesarean " +
  "cesspool chafe chaffing chain chair challenge chamber chamomile champion " +
  "chance change channel chant chaos chaperone chaplain chapped chaps chapter " +
  "character charbroil charcoal charger charging charity charm charred " +
  "charter charting chase chasing chaste chastise chastity chatroom chatter " +
  "chatting chatty cheddar cheek cheer cheese cheesy chef chemicals chemist " +
  "chemo cherisher cherub chess chest chevron chevy chewable chewer chewing " +
  "chewy chief chihuahua childcare childhood childish childlike chili chill " +
  "chimp chip chirping chirpy chitchat chivalry chive chloride chlorine " +
  "choice chomp chooser choosing choosy chop chosen chowder chowtime chrome " +
  "chuck chug chummy chump chunk churn chute cider cilantro cinch cinema " +
  "cinnamon circle circling circular circulate circus citable citadel " +
  "citation citizen citric citrus city civic civil clad claim clambake clammy " +
  "clamor clamp clamshell clang clanking clapped clapper clapping clarify " +
  "clarinet clarity clash clasp class clatter clause clavicle claw clay clean " +
  "clear cleat cleaver cleft clench clergyman clerical clerk clever clicker " +
  "client climate climatic cling clinic clinking clip clique cloak clobber " +
  "clock clone cloning closable closure cloud clover clubbed clubbing " +
  "clubhouse clumsily clunky clustered clutch clutter coach coagulant coastal " +
  "coaster coasting coastland coastline coat coauthor cobalt cobbler cobweb " +
  "cocoa coconut cod coeditor coerce coexist coffee cofounder cognition " +
  "cognitive cogwheel coherence coherent cohesive coil coke cola coleslaw " +
  "coliseum collage collar collected collector collide collie collision " +
  "colonial colonist colonize colony colossal colt come comfort comfy comic " +
  "comma commence commend comment commerce commode commodity commodore common " +
  "commotion commute commuting compacted compacter compactly compactor " +
  "companion company compare compel compile comply component composed " +
  "composer composite compost composure compound compress comprised computer " +
  "computing comrade concave conceal conceded concept concerned concert conch " +
  "concierge concise conclude concrete concur condense condiment condition " +
  "condone conducive conductor conduit cone confess confetti confidant " +
  "confident confider confiding configure confined confining confirm conflict " +
  "conform confound confront congenial congested congrats congress conical " +
  "conjoined conjure conjuror connected connector consensus consent console " +
  "consoling consonant constant constrict construct consult consumer " +
  "consuming contact container contend contented contently contents contest " +
  "context contort contour contrite control contusion convene convent " +
  "copartner cope copied copier copilot coping copious copper copy coral cork " +
  "cornball cornbread corncob cornea corned corner cornfield cornflake " +
  "cornhusk cornmeal cornstalk corny coronary corporal corporate corral " +
  "correct corridor corrode corroding corrosive corsage corset cortex " +
  "cosigner cosmetics cosmic cosmos cosponsor cost cottage cotton couch could " +
  "countable countdown counting countless country county courier covenant " +
  "cover coveted coveting coyness cozily coziness cozy crabgrass crablike " +
  "crabmeat cradle cradling crafter craftily craftsman craftwork crafty " +
  "cranberry crane cranial cranium crank crate crave craving crawfish " +
  "crawlers crawling crayfish crayon crazed crazily craziness creamed creamer " +
  "creamlike crease creasing creatable create creation creative creature " +
  "credible credibly credit creed creme creole crepe crept crescent crested " +
  "cresting crestless crevice crewless crewman crewmate crib cricket crier " +
  "crimp crimson cringing crinkle crinkly crisped crisping crisply crispness " +
  "crispy criteria critter croak crock croon crop cross crouch crouton " +
  "crowbar crowd crown crucial crumb crummiest crummy crumpet crumpled " +
  "cruncher crunching crunchy crusader crux cryptic crystal cubbyhole cube " +
  "cubical cubicle cucumber cuddle cuddly cufflink culinary culminate " +
  "culpable culprit cultivate cultural culture cupbearer cupcake cupid cupped " +
  "cupping curable curator curdle cure curfew curing curled curler curliness " +
  "curling curly curry cursive cursor curtain curtly curtsy curvature curve " +
  "curvy cushy cusp cussed custard custodian custody customary customer " +
  "customize customs cycle cyclic cycling cyclist cylinder cymbal cytoplasm " +
  "cytoplast dab dad daffodil dagger daily daintily dainty dairy daisy " +
  "dallying dance dancing dandelion dander dandruff dandy dangle dangling " +
  "dares daringly darling darn dart darwinism dash dastardly data datebook " +
  "dating daughter daunting dawdler dawn daybed daybreak daycare daydream " +
  "daylight daylong dayroom daytime dazzler dazzling deacon deafening " +
  "deafness dealer dealing dealmaker dealt dean debatable debate debating " +
  "debit debrief debug debunk decade decaf decal decathlon deceased deceiver " +
  "deceiving december decency decent deception deceptive decibel decidable " +
  "decimal decimeter decipher deck declared decode decorated decorator decoy " +
  "decrease decree dedicate dedicator deduce deduct deed deem deepen deeply " +
  "deepness deface defacing defame default defeat defendant defender defense " +
  "defensive deferral deferred defiance defile defiling define definite " +
  "deflate deflation deflator deflected deflector defog deforest defraud " +
  "defrost deftly defuse defy degraded degrading degrease degree dehydrate " +
  "deity dejected delay delegate delegator delete deletion delicacy delicate " +
  "delicious delighted delirious delirium deliverer delivery delouse delta " +
  "deluge delusion deluxe demanding demise democracy democrat demote demotion " +
  "demystify denatured deniable denim denote dense density dental dentist " +
  "denture deny deodorize departed departure depict deplete depletion " +
  "deplored deploy deport depose deprecate deprive depth deputize deputy " +
  "derail deranged derby derived desecrate deserve deserving designate " +
  "designed designer designing deskbound desktop deskwork desolate despise " +
  "destiny destruct detached detail detection detective detector detention " +
  "detergent detonate detonator detoxify detract deuce devalue deviancy " +
  "deviate deviation deviator device devious devotedly devotee devotion " +
  "devourer devouring devoutly dexterity dexterous diabetes diabetic diabolic " +
  "diagnoses diagnosis diagram dial diameter diaper diaphragm diary dice " +
  "dicing dictate dictation dictator difficult diffused diffuser diffusion " +
  "diffusive dig dilation diligence diligent dill dilute dime diminish dimly " +
  "dimmed dimmer dimness dimple diner dingbat dinghy dinginess dingo dingy " +
  "dining dinner diocese dioxide diploma dipped dipper dipping directed " +
  "direction directive directly directory dirtiness disagree disallow " +
  "disarray disband disbelief disburse discern discharge disclose discolor " +
  "discount discourse discover discuss disdain disfigure dish disjoin disk " +
  "disliking dislocate dislodge disloyal dismantle dismount disparate " +
  "disparity dispatch dispense dispersal dispersed disperser displace display " +
  "disprove dispute disregard dissuade distance distant distaste distill " +
  "distinct distract district ditto ditzy dividable divided dividend dividers " +
  "dividing divinely diving divinity divisible divisibly division divisive " +
  "doable docile dock doctrine document dodge dodgy doily doing dole dollar " +
  "dollhouse dollop dolly dolphin domain domelike domestic donated donation " +
  "donator donor donut doodle doorbell doorframe doorknob doorman doormat " +
  "doornail doorpost doorstep doorstop doorway doozy dormitory dorsal dosage " +
  "dose dotted doubling douche dove down dowry doze dragging dragonfly " +
  "dragster dramatic dramatize drank drapery drastic draw dreamboat dreamily " +
  "dreamland dreamless dreamlike dreamt dreamy drearily drench dress drew " +
  "dribble dried drier driller drilling drinkable drinking dripping drippy " +
  "drivable driven driver driveway driving drizzle drizzly drone dropforge " +
  "dropkick droplet dropper drove drudge drum dry dubbed dubiously duchess " +
  "duckbill ducking duckling ducktail ducky duct duffel dugout duh duke duly " +
  "duo dupe duplex duplicate duplicity durable durably duration during dust " +
  "dutiful duty duvet dweeb dwelled dweller dwelling dynamic dynamite " +
  "dyslexia dyslexic each eagle earache eardrum earflap earful earlobe early " +
  "earmark earmuff earphone earpiece earplugs earring earshot earthen " +
  "earthlike earthling earthly earthworm earthy earwig easeful easel easiest " +
  "easily easiness easing eastbound eastcoast easter eatable eaten eatery " +
  "eating eats eaves ebony ebook echelon echidna echo eclair eclipse " +
  "ecologist ecology economic economist economy ecosphere ecosystem edge " +
  "edginess edging edition editor educated education educator eel effective " +
  "effects efficient effort eggbeater egging eggnog eggplant eggshell " +
  "egomaniac either eject elaborate elastic elated elbow eldercare elderly " +
  "eldest electable election elective elephant elevate elevating elevation " +
  "elevator eleven elf eligible eligibly eliminate elite elitism elixir elk " +
  "ellipse elliptic elm elongated elope eloquence eloquent elsewhere elude " +
  "elusive elves email embargo embark embassy embellish ember embezzle " +
  "emblaze emblem embody embolism emboss embroider emcee emerald emergency " +
  "emission emit emote emoticon emotion empathic empathy emperor emphases " +
  "emphasis emphasize emphatic empirical employed employee employer emporium " +
  "empower emu enable enactment enamel enchanted enchilada encircle enclose " +
  "enclosure encode encore encounter encroach encrypt endeared endearing " +
  "ended ending endless endnote endocrine endorphin endorse endowment " +
  "endpoint endurable endurance enduring energetic energize energy enforced " +
  "enforcer engine engorge engraved engraver engraving engross engulf enhance " +
  "enigmatic enjoyable enjoyably enjoyer enjoying enjoyment enlarged " +
  "enlarging enlighten enlisted enquirer enrich enroll ensure entail " +
  "entangled entering entertain enticing entire entitle entity entomb entree " +
  "entrench entryway entwine enunciate envelope enviable enviably envious " +
  "envision envoy enzyme epic epidemic epidermal epidermis epidural epilepsy " +
  "epileptic epilogue epiphany episode equal equate equation equator equinox " +
  "equipment equivocal eradicate erasable erased eraser erasure ergonomic " +
  "errand erratic error escalate escalator escapable escapade escapist eskimo " +
  "esophagus espresso esquire essay essence essential estate esteemed " +
  "estimate estimator estranged estrogen etching eternal eternity ethanol " +
  "ether ethically ethics euphemism evacuate evacuee evade evaluate evaluator " +
  "evaporate evasion evasive even everglade evergreen everybody everyday " +
  "everyone evidence evident evoke evolution evolve exact exalted example " +
  "excavate excavator exceeding exception excess exchange excitable exciting " +
  "exclaim exclude excluding exclusion exclusive excretion excretory " +
  "excursion excusable excusably excuse exemplary exemplify exerciser exert " +
  "exes exfoliate exhale exhume exile existing exit exodus exonerate exorcism " +
  "exorcist expand expanse expansion expansive expectant expedited expediter " +
  "expel expend expenses expensive expert explain expletive explicit exploit " +
  "explore exploring exponent exporter exposable expose exposure express " +
  "expulsion exquisite extended extending extent extenuate exterior external " +
  "extinct extortion extradite extras extrovert extrude extruding fable " +
  "fabric fabulous facebook facedown facelift faceplate faceted facial " +
  "facility facing facsimile faction factoid factor factsheet factual faculty " +
  "fade fading falcon fall false falsify fame familiar family famished " +
  "fanatic fancied fanciness fancy fanfare fanning fantasize fantastic " +
  "fantasy fascism fastball faster fasting fastness faucet favorable " +
  "favorably favored favoring favorite fax feast federal fedora feed feel " +
  "feisty feline feminine feminism feminist feminize femur fence fencing " +
  "fender ferment fernlike ferocious ferocity ferret ferris ferry fervor " +
  "fester festival festive festivity fetal fetch fiber fiction fiddle " +
  "fiddling fidelity fidgeting fidgety fifteen fifth fiftieth fifty figment " +
  "figure figurine filing filled filler filling film filter filtrate finale " +
  "finalist finalize finally finance financial finch fineness finer finicky " +
  "finished finisher finishing finite finless finlike fiscally fit five " +
  "flaccid flagman flagpole flagship flagstick flagstone flail flakily flaky " +
  "flame flammable flanked flanking flannels flap flaring flashback flashbulb " +
  "flashcard flashily flashing flashy flask flatbed flatfoot flatly flatness " +
  "flatten flattered flatterer flattery flattop flatworm flavored flavorful " +
  "flavoring flaxseed fled fleshed fleshy flick flier flight flinch fling " +
  "flint flip flirt float flock floral florist floss flounder flyable flyaway " +
  "flyer flying flyover flypaper foam fog foil folic folk follicle follow " +
  "fondling fondly fondness fondue font food fool footage football footbath " +
  "footboard footer footgear foothill foothold footing footman footnote " +
  "footpad footpath footprint footrest footstool footway footwear footwork " +
  "fossil foster founder founding fountain fox foyer fraction fracture " +
  "fragment fragrance frame framing fraternal frayed fraying frays freckled " +
  "freckles freebase freebee freebie freedom freefall freehand freeing " +
  "freeload freely freemason freeness freestyle freeway freewill freezable " +
  "freezing freight french frenzied frenzy frequency frequent fresh friction " +
  "friday fridge fried friend frill fringe frisbee frisk fritter frivolous " +
  "frolic from front frostbite frosted frostily frosting frostlike frosty " +
  "frozen fructose frugality frugally fruit frying gab gaffe gainfully " +
  "gaining gains gala gallantly galleria gallery galley gallon gallstone " +
  "galore galvanize game gaming gamma gander gangly gangrene gangway gap " +
  "garbage garden gargle garland garlic garment garnet garnish garter gas " +
  "gatherer gathering gating gauging gauze gave gawk gazing gear gecko geek " +
  "geiger gem gender generic generous genetics genre gentile gentleman gently " +
  "gents geography geologic geologist geology geometric geometry geranium " +
  "gerbil geriatric gestate gestation gesture getaway getting getup giant " +
  "gibberish giblet giddily giddiness giddy gift gigabyte gigahertz gigantic " +
  "giggle giggling giggly gigolo gilled gills gimmick girdle giveaway given " +
  "giver giving gizmo gizzard glacial glacier glade gladiator gladly " +
  "glamorous glamour glance glancing glandular glass gleaming gleeful glider " +
  "gliding glimmer glisten glitch glitter glitzy gloater gloating glorified " +
  "glorifier glorify glorious glory gloss glove glowing glowworm glucose glue " +
  "gluten glutinous glutton gnarly gnat goal goatskin goes goggles going " +
  "goldfish goldmine goldsmith golf goliath golly gondola gone gong good " +
  "gooey gooseneck goosey gopher gore gorged gorgeous gory gosling gothic " +
  "gotten gout gown grab graceful gracious gradation graded grader gradient " +
  "grading gradually graduate graffiti grafted grafting grain granddad " +
  "grandkid grandly grandma grandpa grandson granite granny granola granular " +
  "grape graph grapple grappling grasp grass gratified gratify grating " +
  "gratitude gratuity gravel gravitate gravy gray grazing greasily green " +
  "greeter greeting grew greyhound grid grill grinch grinning grip gristle " +
  "grit groin groom groove grooving groovy ground grouped grout grove grower " +
  "growing growl grub grueling grumble grumbling grumbly grunge guacamole " +
  "guidable guidance guide guiding guileless guise gulf gullible gully gulp " +
  "gumball gumdrop gumminess gumming gummy gurgle gurgling guru gush gusto " +
  "gusty guts gutter guy guzzler gyration habitable habitant habitat habitual " +
  "had haggler haiku half halogen halt halved halves hamburger hamlet hammock " +
  "hamster hamstring handbag handball handbook handbrake handcart handclap " +
  "handclasp handcraft handcuff handed handful handgrip handheld handiness " +
  "handiwork handlebar handled handler handling handmade handoff handpick " +
  "handprint handrail handsaw handset handsfree handstand handwash handwork " +
  "handwoven handwrite handyman hangnail hangout hangover hangup hankering " +
  "hankie hanoi haphazard happening happier happiest happily happiness happy " +
  "harbor hardback hardball hardcover hardedge hardened hardener hardening " +
  "hardhat hardhead hardiness hardly hardness hardship hardwired hardwood " +
  "hardy harmless harmonica harmonics harmonize harmony harness harpist " +
  "harvest hash haste hastily hastiness hasty hatbox hatchback hatchery " +
  "hatchet hatching hatchling hatless haven hazard hazelnut hazily haziness " +
  "hazing hazy headache headband headboard headcount headdress headed header " +
  "headfirst headgear heading headlamp headlock headphone headpiece headrest " +
  "headroom headset headsman headstand headstone headway headwear heap heat " +
  "heave heavily heaviness heaving hedge hedging heftiness hefty helium " +
  "helmet helper helpful helping helpline hemlock hemstitch hence henchman " +
  "henna herald herbal herbicide herbs heritage hermit heroics heroism " +
  "herring herself hertz hesitancy hesitant hesitate hexagon hexagram hubcap " +
  "huddle huddling huff hug hula hulk hull human humble humbling humbly humid " +
  "humility humming hummus humongous humorist humorous humpback humped humvee " +
  "hunchback hundredth hungrily hunk hunter hunting huntress huntsman hurdle " +
  "hurled hurler hurling hurray hurricane hurried hurry husband hush husked " +
  "huskiness hut hybrid hydrated hydration hydrogen hydroxide hyperlink " +
  "hypertext hyphen hypnoses hypnosis hypnotic hypnotism hypnotist hypnotize " +
  "hypocrisy hypocrite ibuprofen ice iciness icing icky icon icy idealism " +
  "idealist idealize ideally idealness identical identify identity ideology " +
  "idiocy idiom idly igloo ignition iguana illicitly illusion illusive image " +
  "imaginary imagines imaging imbecile imitate imitation immature immerse " +
  "immersion imminent immobile immodest immorally immortal immovable " +
  "immovably immunity immunize impale impart impeach impeding impending " +
  "imperfect imperial impish implant implement implicate implicit implode " +
  "implosion implosive imply impolite important importer impose imposing " +
  "impotence impotency impotent impound imprecise imprint impromptu improper " +
  "improve improving improvise imprudent impulse impulsive iodine iodize ion " +
  "iota ire iridium iris irk iron irregular irrigate irritable irritably " +
  "irritant island isolated isolating isolation isotope issue issuing " +
  "italicize italics item itinerary itunes ivory ivy jab jackal jacket " +
  "jackknife jackpot jalapeno jam janitor january jargon jarring jasmine " +
  "jaundice jaunt java jawed jawline jaws jaybird jaywalker jazz jeep " +
  "jeeringly jellied jelly jersey jester jet jiffy jigsaw jimmy jingle " +
  "jingling job jockey jogger jogging john joining jokester jokingly " +
  "jolliness jolly jolt jot jovial joyfully joylessly joyous joyride joystick " +
  "jubilance jubilant judge judgingly judicial judiciary judo juggle juggling " +
  "jugular juice juiciness juicy jujitsu jukebox july jumble jumbo jump " +
  "junction juncture june junior juniper jurist juror jury justice justifier " +
  "justify justly justness juvenile kabob kangaroo karaoke karate karma kebab " +
  "keenly keenness keep keg kelp kennel kept kerchief kerosene kettle kiln " +
  "kilobyte kilogram kilometer kilowatt kilt kimono kindle kindling kindly " +
  "kindness kindred kinetic kinfolk king kinship kinsman kinswoman kissable " +
  "kisser kissing kitchen kite kitten kitty kiwi knack knapsack knee knelt " +
  "knickers knoll koala kooky kosher krypton kudos kung labored laborer " +
  "laborious labrador ladder ladies ladle ladybug ladylike lagged lagging " +
  "lagoon lair lake lance landed landfall landfill landing landlady landline " +
  "landlord landmark landmass landmine landowner landscape landside landslide " +
  "language lankiness lanky lantern lapdog lapel lapped lapping laptop lard " +
  "large lark lash lasso last latch late lather latitude latrine latter " +
  "latticed launch launder laundry laurel lavender lavish laxative lecturer " +
  "left legacy legal legend legged leggings legible legibly legislate " +
  "legitimate legroom legume legwork lemon lend length lens lent leotard " +
  "lesser letdown lethargic lethargy letter lettuce level levers levitate " +
  "levitator liability liable liberty librarian library licking licorice lid " +
  "life lifter lifting liftoff ligament likely likeness likewise liking lilac " +
  "lilly lily limb limeade limelight limes limit line lingo linguini linguist " +
  "lining linked linoleum linseed lint lion lip liquefy liqueur liquid lisp " +
  "list litigate litigator litmus litter little livable lived lively liver " +
  "livestock lividly living lizard lubricant lubricate lucid luckily " +
  "luckiness lucrative ludicrous lugged lullaby lumber luminance luminous " +
  "lunar lunchbox luncheon lunchroom lunchtime lung lurch lure luridness " +
  "lushly lushness luster lustfully lustily lustiness lustrous lusty " +
  "luxurious luxury lying lyrically lyricism lyricist lyrics macarena " +
  "macaroni macaw mace machine machinist magazine magenta magical magician " +
  "magma magnesium magnetic magnetism magnetize magnifier magnify magnitude " +
  "magnolia mahogany majestic majesty majorette majority makeover maker " +
  "makeshift making malformed malt mama mammal mammary mammogram manatee " +
  "mandarin mandate mandatory mandolin mango mangy manhandle manhole manhood " +
  "manhunt manicotti manicure manifesto manila mankind manlike manliness " +
  "manly manmade manned mannish manor manpower mantis mantra manual many map " +
  "marathon marauding marbled marbles marbling march mardi margarine " +
  "margarita margin marigold marina marine marital maritime marlin marmalade " +
  "maroon married marrow marry marshland marshy marsupial marvelous marzipan " +
  "mascot masculine mashed mashing massager masses massive mastiff matador " +
  "matchbook matchbox matcher matching matchless material maternal maternity " +
  "math mating matriarch matrimony matrix matron matted matter maturely " +
  "maturing maturity mauve maverick maximize maximum maybe mayday mayflower " +
  "mobile mobility mobilize mobster mocha mockup modified modify modular " +
  "modulator module moisten moistness moisture molar molasses mold molecular " +
  "molecule molehill mollusk mom monastery monday monetary monetize moneybags " +
  "moneywise mongoose mongrel monitor monkhood monogamy monogram monologue " +
  "monopoly monorail monotone monotype monoxide monsieur monsoon monstrous " +
  "monthly monument moocher moodiness mooing moonbeam mooned moonlight " +
  "moonlike moonlit moonrise moonscape moonshine moonstone moonwalk mop " +
  "morale morality morally morphine morphing morse mortality mortally " +
  "mortician mortified mortify mortuary mosaic mossy most mothball mothproof " +
  "motion motivate motivator motive motocross motor motto mountable mountain " +
  "mounted mounting mouse mousiness moustache mousy mouth movable move movie " +
  "moving mower mowing much muck mud mug mulberry mulch mule mulled mullets " +
  "multiple multiply multitask multitude mumble mumbling mumbo mummified " +
  "mummify mummy mumps munchkin mundane municipal muppet mural murmuring " +
  "muscular museum mushily mushiness mushroom mushy music musket muskiness " +
  "musky mustang mustard muster mustiness musty mutable mutate mutation mute " +
  "mutiny mutt mutual muzzle myself myspace mystified mystify myth nacho nail " +
  "name naming nanny nanometer nape napkin napped napping nappy narrow " +
  "nastily nastiness national native nativity natural nature naturist " +
  "nautical navigate navigator navy nearby nearest nearly nearness neatly " +
  "neatness nebula nebulizer nectar negate negation negative negotiate " +
  "nemeses neon nephew nest net neurology neuron neurosis neuter neutron " +
  "never next nibble nickname nicotine niece nifty nimble nimbly nineteen " +
  "ninetieth ninja nintendo ninth nuclear nuclei nucleus nugget number " +
  "numbing numbly numbness numeral numerate numerator numeric numerous " +
  "nuptials nursery nursing nurture nutcase nutlike nutmeg nutrient nutshell " +
  "nuttiness nutty nuzzle nylon oak oasis oat obedience obedient obituary " +
  "object obligate obliged oblong oboe obscure obscurity observant observer " +
  "observing obsessed obsession obsessive obsolete obstacle obstinate " +
  "obstruct obtain obtrusive obtuse obvious occultist occupancy occupant " +
  "occupier occupy ocean ocelot octagon octane october ogle oil oink ointment " +
  "okay old olive olympics omega omen omission omit omnivore onboard ongoing " +
  "onion online onlooker only onscreen onset onshore onslaught onstage onto " +
  "onyx oops ooze oozy opacity opal open operable operate operating operation " +
  "operative operator opium opossum opponent oppose opposing opposite opt " +
  "opulently osmosis other otter ouch ought ounce outage outback outbid " +
  "outboard outbound outbreak outburst outclass outcome outdated outdoors " +
  "outer outfield outfit outflank outgoing outgrow outhouse outing outlast " +
  "outlet outline outlook outlying outmatch outmost outnumber outplayed " +
  "outpost outpour output outrank outreach outright outscore outsell outshine " +
  "outshoot outsider outskirts outsmart outsource outspoken outtakes outthink " +
  "outweigh outwit oval ovary oven overact overall overarch overbid overbill " +
  "overbite overblown overboard overbook overbuilt overcast overcoat overcome " +
  "overcook overcrowd overdraft overdrawn overdress overdrive overeager " +
  "overeater overexert overfed overfeed overfill overflow overfull overgrown " +
  "overhand overhang overhaul overhead overhear overheat overhung overjoyed " +
  "overlabor overlaid overlap overlay overload overlook overlord overlying " +
  "overnight overpass overpay overplant overplay overpower overprice overrate " +
  "overreach overreact override overripe overrule overrun overshoot overshot " +
  "oversized oversleep oversold overspend overstate overstay overstep " +
  "overstock overstuff oversweet overtake overthrow overtime overtly overtone " +
  "overture overturn overuse overvalue overview overwrite owl oxford oxidant " +
  "oxidation oxidize oxidizing oxygen oxymoron oyster ozone paced pacemaker " +
  "pacific pacifier pacifism pacifist pacify padded padding paddle paddling " +
  "padlock pagan pager paging pajamas palace palatable palm palpable " +
  "palpitate paltry pampered pamperer pampers pamphlet panama pancake " +
  "pancreas panda pandemic panhandle panning panorama panoramic panther " +
  "pantomime pantry pants pantyhose paparazzi papaya paper paprika papyrus " +
  "parabola parachute parade paradox paragraph parakeet paralegal paralyze " +
  "paramedic parameter paramount parasail parcel parched parchment pardon " +
  "parish parka parking parkway parlor parmesan parole parsley parsnip " +
  "partake parted parting partition partly partner partridge party passable " +
  "passably passage passcode passenger passerby passing passion passive " +
  "passivism passover passport password pasta pasted pastel pastime pastor " +
  "pastrami pasture pasty patchwork patchy paternal paternity path patience " +
  "patient patio patriarch patrol patronize pauper pavement paver pavestone " +
  "pavilion paving pawing payable payback paycheck payday payee payer paying " +
  "payment payphone payroll pebble pebbly pecan pectin peculiar peddling " +
  "pediatric pedicure pedigree pedometer pegboard pelican pellet pelt pelvis " +
  "penalize penalty pencil pendant pending penholder penknife pennant penny " +
  "penpal pension pentagon pentagram pep perceive percent perch percolate " +
  "perennial perfected perfectly perfume periscope perjurer perjury perkiness " +
  "perky perm peroxide perpetual perplexed persecute persevere persuaded " +
  "persuader pesky peso petal petite petition petri petroleum petted " +
  "petticoat pettiness petunia phantom phoenix phonebook phoney phonics " +
  "phoniness phony photo phrase phrasing placard placate plank planner plant " +
  "plasma plaster plastic plated platform plating platinum platonic platter " +
  "plausible plausibly playable playback player playful playgroup playhouse " +
  "playing playlist playmaker playmate playoff playpen playroom playset " +
  "plaything playtime plaza pleat pledge plentiful plenty plethora plexiglas " +
  "pliable plod plop plot plow ploy pluck plug plunging plural plus plutonium " +
  "plywood pod poem poet pogo pointed pointer pointing pointy poise poker " +
  "poking polar policy polio polish politely polka polo polyester polygon " +
  "polygraph polymer poncho pond pony popcorn pope poplar popper poppy " +
  "popsicle populace popular populate porcupine pork porous porridge portable " +
  "portal portfolio porthole portion portly portside poser posh posing " +
  "possible possibly possum postage postal postbox postcard posted poster " +
  "posting postnasal posture pouch pounce pouncing pound pouring powdered " +
  "powdering powdery power powwow pox praising prance prancing pranker " +
  "prankish prankster prayer praying preacher preaching preachy preamble " +
  "precinct precise precision precook precut predefine predict preface prefix " +
  "preflight preformed pregame pregnancy pregnant preheated prelaunch prelaw " +
  "prelude premiere premises premium prenatal preoccupy preorder prepaid " +
  "prepay preplan preppy preschool prescribe preseason preset preshow " +
  "president presoak press presume presuming preteen pretended pretender " +
  "pretense pretext pretty pretzel prevail prevalent prevent preview previous " +
  "prewashed pried primal primarily primary primate primer primp princess " +
  "print prior prism prissy pristine privacy private privatize prize " +
  "proactive probable probably probation probe probing probiotic procedure " +
  "process proclaim procreate procurer prodigal prodigy produce product " +
  "profane profanity professed professor profile profound profusely progeny " +
  "prognosis program progress projector prologue prolonged promenade promoter " +
  "promotion prompter promptly prone prong pronounce pronto proofing " +
  "proofread proofs propeller properly property proponent proposal propose " +
  "props prorate proud provable proved proven provided provider providing " +
  "province proving provoke provoking provolone prowess prowler prowling " +
  "proximity proxy prozac prude prudishly prune pruning pry psychic public " +
  "publisher pucker pueblo pug pull pulmonary pulp pulsate pulse pulverize " +
  "puma pumice pummel punctual punctuate punctured pungent punk pupil puppet " +
  "puppy purchase purebred purely pureness purgatory purge purging purifier " +
  "purify purist puritan purity purple purplish purposely purr purse " +
  "pursuable pursuant pursuit purveyor putdown putt puzzle puzzling pyramid " +
  "pyromania python quail quaintly quake quaking qualified qualifier qualify " +
  "quality qualm quantum quarry quartered quarterly quarters quartet quench " +
  "query quicken quickly quickness quicksand quickstep quiet quill quilt " +
  "quintet quintuple quirk quiver quizzical quotable quotation quote race " +
  "racing racism rack racoon radar radial radiance radiantly radiated " +
  "radiation radiator radio radish raffle raft ragged ragweed raider railcar " +
  "railing railroad railway raisin rake raking rally ramble rambling ramp " +
  "ramrod ranch random ranged ranging ranked ranking ransack rare rarity " +
  "rascal rasping ravage raven ravine raving ravioli ravishing reabsorb reach " +
  "reacquire reaction reactive reactor reaffirm ream reanalyze reappear " +
  "reapply reappoint reapprove rearrange rearview reason reassign reassure " +
  "reattach reawake rebalance rebate rebel rebirth reboot reborn rebound " +
  "rebuff rebuild rebuilt rebuttal recall recant recapture recast recede " +
  "recent recess recharger recipient recital recite reclaim recliner " +
  "reclining recluse reclusive recognize recoil recollect recolor reconcile " +
  "reconfirm reconvene recopy record recount recoup recovery recreate rectal " +
  "rectangle rectified rectify recycled recycler recycling reemerge reenact " +
  "reenter reentry reexamine referable referee reference refill refinance " +
  "refined refinery refining refinish reflected reflector reflex refocus " +
  "refold reforest reformat reformed reformer reformist refract refrain " +
  "refreeze refresh refried refueling refund refurbish refurnish refusal " +
  "refuse refusing refutable refute regain regalia regally reggae regime " +
  "region register registrar registry regress regroup regular regulate " +
  "regulator rehab reheat rehire rehydrate reimburse reissue reiterate " +
  "rejoice rejoicing rejoin rekindle relatable related relation relative " +
  "relax relay relearn release relenting reliable reliably reliance reliant " +
  "relic relieve relieving relight relish relive reload relocate relock " +
  "reluctant rely remake remark remarry rematch remedial remedy remember " +
  "reminder remindful remission remix remnant remodeler remold remote " +
  "removable removal removed remover removing rename renderer rendering " +
  "rendition renegade renewable renewably renewal renewed renounce renovate " +
  "renovator rentable rental rented renter reoccupy reoccur reopen reorder " +
  "repackage repacking repair repave repaying repayment repeal repeated " +
  "repeater repent rephrase replace replay replica reply reporter repose " +
  "repossess repost repressed reprimand reprint reprise reproach reprocess " +
  "reproduce reprogram reps reptile reptilian repugnant repurpose reputable " +
  "reputably request require requisite reroute rerun resale resample rescuer " +
  "reseal research reselect reseller resemble resend reset reshape reshoot " +
  "reshuffle residence residency resident residual residue resilient " +
  "resistant resisting resize resolute resolved resonant resonate resort " +
  "resource respect resubmit result resume resupply resurface resurrect " +
  "retail retainer retaining retake retaliate retention rethink retinal " +
  "retired retiree retiring retold retool retorted retouch retrace retract " +
  "retrain retread retreat retrial retrieval retriever retry return retying " +
  "retype reunion reunite reusable reuse reveal reveler revenue reverb " +
  "revered reverence reverend reversal reverse reversing reversion revert " +
  "revisable revise revision revisit revivable revival reviver reviving " +
  "revocable revoke revolt revolver revolving rewash rewind rewire reword " +
  "rework rewrap rewrite rhyme ribbon ribcage rice riches richly richness " +
  "rickety ricotta ride riding rifling rigging rigor rimless rimmed rind rink " +
  "rinse rinsing ripcord ripeness ripening ripping ripple rippling riptide " +
  "rise rising risk risotto ritalin ritzy rival riverbank riverbed riverboat " +
  "riverside riveter riveting roamer roaming roast robbing robe robin " +
  "robotics rockband rocker rocket rockfish rockiness rocking rocklike " +
  "rockslide rockstar rocky roman romp rope roping roster rosy roulette " +
  "rounding roundish roundness roundup roundworm routine routing rover roving " +
  "royal rubbed rubber rubbing rubble rubdown ruby ruckus rudder rug rule " +
  "rumble rumbling rummage rumor runaround rundown runner running runny runt " +
  "runway rural ruse rush rut sabbath sacrament sacred sacrifice saddlebag " +
  "saddled saddling safari safeguard safehouse safely safeness saffron saga " +
  "sage said saint sake salad salami salaried salary saline salon saloon " +
  "salsa salt salutary salute salvage salvaging salvation same sample " +
  "sampling sanction sanctity sanctuary sandal sandbag sandbank sandbar " +
  "sandbox sanded sandfish sanding sandlot sandpaper sandpit sandstone " +
  "sandstorm sandworm sandy sanitary sanitizer sank santa sapling sappiness " +
  "sappy sardine sash sasquatch sassy satchel satiable satin satirical " +
  "satisfied satisfy saturate saturday sauciness saucy sauna savanna saved " +
  "savings savior savor saxophone say scale scaling scallion scallop scalping " +
  "scanner scanning scant scapegoat scavenger scenic schedule schematic " +
  "scheme scheming schilling schnapps scholar science scientist scion scoff " +
  "scone scoop scooter scope scorebook scorecard scored scoreless scorer " +
  "scoring scorpion scotch scoundrel scoured scouring scouting scouts " +
  "scowling scraggly scrambled scrambler scratch screen scribble scribe " +
  "scribing scrimmage script scroll scrooge scrounger scrubbed scrubber " +
  "scruffy scrunch scrutiny scuba scuff sculptor sculpture scurvy scuttle " +
  "secluded secluding seclusion second secrecy secret sectional sector " +
  "secular securely security sedan sediment seduce seducing segment seismic " +
  "seizing seldom selected selection selective selector self seltzer semantic " +
  "semester semicolon semifinal seminar semisoft semisweet senate senator " +
  "send senior senorita sensation sensitive sensitize sensually sensuous " +
  "sepia september septic septum sequel sequence sequester series sermon " +
  "serpent serrated serve service serving sesame sessions setback setting " +
  "settle settling setup sevenfold seventeen seventh seventy severity shaded " +
  "shadily shadiness shading shadow shaft shale shallot shallow shampoo " +
  "shamrock shank shanty shape shaping share sharpener sharper sharpie " +
  "sharply sharpness shawl sheath shed sheep sheet shelf shell shelter shelve " +
  "shelving sherry shield shifter shifting shifty shimmer shimmy shindig " +
  "shine shingle shininess shining shiny ship shirt shock shone shoplift " +
  "shopper shopping shoptalk shore shortage shortcake shortcut shorten " +
  "shorter shorthand shortlist shortly shortness shorts shortwave shorty " +
  "shout showbiz showcase showdown shower showgirl showing showman shown " +
  "showoff showpiece showplace showroom showy shrank shredder shredding " +
  "shrewdly shrill shrimp shrine shrink shrivel shrouded shrubbery shrubs " +
  "shrug shrunk shucking shuffle shuffling shush shut shy sial siberian " +
  "sibling siding sierra siesta sift silenced silencer silent silica silicon " +
  "silk silliness silo silt silver similarly simile simmering simple simplify " +
  "simply sincere sincerity singer singing single singular sinless sinner " +
  "sinuous sip siren sister sitcom sitter sitting situated situation sixfold " +
  "sixteen sixth sixties sixtieth sixtyfold sizable sizably size sizing " +
  "sizzle sizzling skater skating skedaddle skeletal skeleton skeptic sketch " +
  "skewed skewer skid skied skier skies skiing skimmed skimmer skimming " +
  "skimpily skincare skinhead skintight skipper skipping skirmish skirt " +
  "skittle skydiver skylight skyline skype skyrocket slab slain slang " +
  "slapping slapstick slashed slashing slate slather slaw sled sleek sleep " +
  "sleet sleeve slept slicing slick slider slideshow sliding slighted " +
  "slighting slightly slimness slimy slinging slingshot slinky slip slit " +
  "sliver slogan sloped sloping slot slouching slouchy sludge slug slurp " +
  "slush sly small smartly smartness smelting smile smilingly smirk smite " +
  "smith smitten smock smog smoked smokeless smokiness smoking smoky smolder " +
  "smooth smudge smudgy snack snaking snap snarl snazzy snide snippet " +
  "snipping snitch snooper snooze snore snoring snorkel snort snout snowbird " +
  "snowboard snowbound snowcap snowdrop snowfall snowfield snowflake " +
  "snowiness snowless snowman snowplow snowshoe snowstorm snowsuit snowy " +
  "snuff snuggle snugness speak spearfish spearhead spearman spearmint " +
  "species specimen specked speckled specks spectacle spectator spectrum " +
  "speculate speech speed spellbind speller spelling spendable spender " +
  "spending spent spew sphere spherical sphinx spider spied spiffy spill " +
  "spilt spinach spinal spindle spinner spinning spinout spinster spiny " +
  "spiral spirited spiritism spirits spiritual splashed splashing splashy " +
  "splatter spleen splendid splendor splicing splinter splotchy splurge " +
  "spoken spokesman sponge spongy sponsor spoof spool spoon spore sporting " +
  "sports sporty spotless spotlight spotted spotter spotting spotty spousal " +
  "spouse sprain sprang sprawl spray spree sprig spring sprinkled sprinkler " +
  "sprint sprite sprout spruce sprung spry spud spur sputter spyglass squad " +
  "squall squash squatted squatter squatting squeak squeamish squeegee " +
  "squeeze squeezing squid squiggle squiggly squint squire squirt squishier " +
  "squishy stack stadium staff stage staging stagnant stagnate stainable " +
  "stained staining stainless stamina stammer stamp stand stank staple " +
  "stapling starboard starch stardom stardust starfish stargazer staring " +
  "stark starless starlet starlight starlit starring starry starship starter " +
  "starting startle startling startup stash state static statistic statue " +
  "stature status statute statutory staunch stays steadfast steadier steadily " +
  "steadying steam steed steep steerable steering steersman stegosaur stellar " +
  "stem stench stencil step stereo sterile sterility sterilize sterling " +
  "sternness sternum stew stick stiffen stiffly stiffness stifle stifling " +
  "stilt stimulant stimulate stimuli stimulus stinger stingily stinging " +
  "stingray stipend stipulate stir stitch stock stoic stoke stole stomp " +
  "stonewall stonework stoning stony stood stooge stool stoop stoplight " +
  "stoppable stoppage stopped stopper stopping stopwatch storable storeroom " +
  "storewide storm stout stove stowaway stowing straddle straggler strangely " +
  "strategic strategy stratus straw stray streak stream street strength " +
  "strenuous strep stretch strewn strict stride strike striking strive " +
  "striving strobe strode stroller strongbox strongly strongman struck " +
  "structure strudel strum strung strut stubbed stubble stubbly stucco stuck " +
  "student studied studio study stuffed stuffing stuffy stumble stumbling " +
  "stump stupor sturdily sturdy styling stylishly stylist stylized stylus " +
  "suave subarctic subatomic subdivide subdued subduing subfloor subgroup " +
  "subheader subject sublease sublet sublevel sublime submarine submerge " +
  "submersed submitter subpanel subpar subplot subprime subscribe subscript " +
  "subsector subside subsiding subsidize subsidy subsoil subsonic substance " +
  "subsystem subtext subtitle subtly subtotal subtract subtype suburb subway " +
  "subwoofer subzero succulent such suction sudden sudoku suds suffice suffix " +
  "sugar suggest suing suitable suitably suitcase suitor sulfate sulfide " +
  "sulfite sulfur sulphuric sultry superbowl superglue superhero superior " +
  "superjet superman supermom supernova supervise supper supplier supply " +
  "support supremacy supreme surcharge surely sureness surface surfacing " +
  "surfboard surfer surgical surging surname surpass surplus surprise surreal " +
  "surrender surrogate surround survey survival survive surviving survivor " +
  "sushi suspect suspend suspense sustained sustainer swab swaddling swagger " +
  "swampland swan swapping sway swear sweep swell swept swerve swifter " +
  "swiftly swiftness swimmable swimmer swimming swimsuit swimwear swinging " +
  "swipe swirl switch swivel swizzle swooned swoop swoosh swore sworn swung " +
  "sycamore sympathy symphonic symphony symptom synapse syndrome synergy " +
  "synopses synopsis synthesis synthetic syrup system tabasco tabby tableful " +
  "tables tablet tabloid tackiness tacking tackle tackling taco tactful " +
  "tactical tactics tactile tadpole taekwondo tag tainted take taking talcum " +
  "talisman tall talon tamale tameness tamer tank tanned tannery tanning " +
  "tapeless tapered tapering tapestry tapioca tapping taps target tarmac " +
  "tarnish tartar tartly tartness task tassel taste tastiness tasting tasty " +
  "tattered tattle tattling tattoo tavern thank that thaw theater theatrics " +
  "thee theft theme theology theorize thermal thermos thesaurus these thesis " +
  "thespian thicken thicket thickness thieving thievish thigh thimble thing " +
  "think thinly thinner thinness thinning thirstily thirsting thirsty " +
  "thirteen thirty thong those thousand thread threefold thrill thrive " +
  "thriving throat throbbing throng throwaway throwback thrower throwing thud " +
  "thumb thumping thursday thus thyself tiara tibia tidal tidbit tidiness " +
  "tidings tidy tiger tighten tightly tightness tightrope tightwad tigress " +
  "tile tiling till tilt timing timothy tinderbox tinfoil tingle tingling " +
  "tingly tinker tinkling tinsel tinsmith tint tinwork tiny tipoff tipped " +
  "tipper tipping tiptoeing tiptop tiring tissue trace tracing track traction " +
  "tractor trade trading tradition traffic trailing trailside train traitor " +
  "trance tranquil transfer transform translate transpire transport transpose " +
  "travel traverse travesty tray treachery treading treadmill treason treat " +
  "treble tree trekker tremor trench trend triage trial triangle tribesman " +
  "tribunal tribune tributary tribute triceps tricolor tricycle trident tried " +
  "trifle trifocals trillion trilogy trimester trimmer trimming trimness " +
  "trinity trio tripod tripping triumph trivial trodden trolling trombone " +
  "trophy tropical tropics troubling trough trousers trout trowel truce truck " +
  "truffle trump trunks truth try tubby tubeless tubular tucking tuesday tug " +
  "tuition tulip tumble tumbling tummy turban turbine turbofan turbojet " +
  "turbulent turf turkey turret turtle tusk tutor tutu tux tweak tweed tweet " +
  "tweezers twelve twentieth twenty twerp twice twiddle twiddling twig " +
  "twilight twine twins twirl twisted twister twisting twisty twitch twitter " +
  "tycoon tying tyke udder ultimate ultimatum ultra umbilical umbrella umpire " +
  "unabashed unadorned unadvised unaired unaligned unaltered unarmored " +
  "unaudited unawake unbaked unbalance unbeaten unbend unbent unbiased " +
  "unbitten unblended unblessed unblock unbolted unbounded unboxed unbraided " +
  "unbridle unbroken unbuckled unbundle unburned unbutton uncanny uncapped " +
  "uncaring unchain unchanged uncharted uncheck uncivil unclad unclaimed " +
  "unclamped unclasp uncle unclip uncloak unclog uncoated uncoiled uncolored " +
  "uncombed uncommon uncooked uncork uncorrupt uncounted uncouple uncouth " +
  "uncover uncross uncrown uncured uncurious uncurled uncut undamaged undated " +
  "undaunted undecided undefined underarm undercoat undercook undercut " +
  "underdog underdone underfed underfeed underfoot undergo undergrad " +
  "underhand underline underling undermost underpaid underpass underpay " +
  "underrate undertake undertone undertook undertow underuse underwear " +
  "underwent underwire undesired undiluted undivided undocked undoing " +
  "undrafted undress undrilled undusted undying unearned unearth uneatable " +
  "uneaten unedited unelected unending unenvied unequal unethical uneven " +
  "unexposed unfailing unfasten unfazed unfeeling unfiled unfilled unfixable " +
  "unfixed unflawed unfocused unfold unfounded unframed unfreeze unfrosted " +
  "unfrozen unfunded unglazed ungloved unglue ungodly ungraded ungreased " +
  "unguarded unguided unhappily unharmed unheard unhearing unheated unhidden " +
  "unhinge unhitched unhook unicorn unicycle unified unifier uniformed " +
  "uniformly unify unimpeded uninsured uninvited union uniquely unisexual " +
  "unison unissued unit universal universe unknotted unknowing unknown " +
  "unlaced unlatch unleaded unlearned unleash unless unleveled unlighted " +
  "unlikable unlimited unlined unlinked unlisted unlit unlivable unloaded " +
  "unloader unlocked unlocking unlovable unlovely unloving unluckily unmade " +
  "unmanned unmapped unmarked unmasked unmasking unmatched unmixable unmixed " +
  "unmolded unmoral unmovable unmoved unmoving unnamable unnamed unnatural " +
  "unneeded unnoticed unopened unopposed unpack unpadded unpaired unpaved " +
  "unpeeled unpicked unpiloted unpinned unplanned unplanted unpledged " +
  "unplowed unplug unpopular unproven unquote unranked unrated unraveled " +
  "unreached unread unreal unreeling unrefined unrelated unrented unretired " +
  "unrevised unrigged unripe unrivaled unroasted unrobed unroll unruffled " +
  "unrushed unsaddle unsaid unsalted unsaved unsavory unscathed unscented " +
  "unscrew unsealed unseated unsecured unseeing unseemly unseen unselect " +
  "unselfish unsent unsettled unshaved unshaven unsheathe unshipped unsigned " +
  "unsmooth unsnap unsocial unsoiled unsold unsolved unsorted unspoken " +
  "unstaffed unstamped unsteady unsterile unstirred unstitch unstopped " +
  "unstuck unstuffed unstylish unsubtle unsubtly unsuited unsworn untagged " +
  "untainted untaken untamed untangled untapped untaxed unthawed unthread " +
  "untie until untimed untimely untitled untoasted untold untouched untracked " +
  "untrained untreated untried untrimmed untrue untruth unturned untwist " +
  "untying unusable unused unusual unvalued unvaried unvarying unveiled " +
  "unveiling unvented unviable unvisited unvocal unwashed unwatched unweave " +
  "unwed unwelcome unwieldy unwilling unwind unwired unwitting unwomanly " +
  "unworldly unworn unwoven unwrapped unwritten unzip upbeat upchuck " +
  "upcountry update upfront upgrade upheaval upheld uphill uphold uplifted " +
  "uplifting upload upon upper upright uprising upriver uproot upscale upside " +
  "upstage upstairs upstart upstate upstream upstroke upswing uptake uptight " +
  "uptown upturned upwind uranium urban urchin urethane urgency urging " +
  "urologist urology usable usage useable used user usher usual utensil " +
  "utility utilize utmost utopia utter vacancy vacant vacate vacation " +
  "vagabond vagrancy valiant valid valium valley valuables value vanilla " +
  "vanish vanity vanquish vantage vaporizer variable variably varied variety " +
  "various varmint varnish varsity varying vascular vaseline vastly vastness " +
  "veal vegan veggie vehicular velcro velocity velvet vendetta vending vendor " +
  "veneering ventricle venture venue venus verbalize verbally verbose verdict " +
  "verify verse version versus vertebrae vertical vertigo very vessel vest " +
  "veteran veto viability viable vibes vice vicinity victory video viewable " +
  "viewer viewing viewless viewpoint vigorous village villain vindicate " +
  "vineyard vintage violate violation violator violet violin viper viral " +
  "virtual virtuous virus visa viscosity viscous viselike visible visibly " +
  "vision visiting visitor visor vista vitality vitalize vitally vitamins " +
  "vivacious vividly vividness vixen vocalist vocalize vocally vocation voice " +
  "voicing volatile volley voltage volumes voter voting voucher vowed vowel " +
  "voyage wackiness wad wafer waffle waged wager wages waggle wagon wake " +
  "waking walk walmart walnut walrus waltz wand wannabe wanted wanting wasabi " +
  "washable washbasin washboard washbowl washday washed washer washhouse " +
  "washing washout washroom washstand washtub wasp wasting watch water " +
  "waviness waving wavy wham wharf wheat whenever whiff whimsical whisking " +
  "whoever whole whomever whoopee whooping whoops why wick widely widen " +
  "widget width wieldable wielder wife wifi wikipedia wildcard wildcat wilder " +
  "wildfire wildfowl wildland wildlife wildly wildness willed willfully " +
  "willing willow willpower wilt wind wing winking winner winnings winter " +
  "wipe wired wireless wiring wiry wisdom wise wish wisplike wispy wizard wok " +
  "wolf wolverine womanhood womankind womanlike womanly womb woof wooing wool " +
  "woozy word work worshiper woven wow wrangle wreath wrench wriggle wriggly " +
  "wrist writing written wrought xenon xerox yahoo yam yanking yapping yard " +
  "yarn yeah yearbook yearling yearly yearning yeast yelp yen yesterday " +
  "yiddish yield yin yippee yodel yoga yogurt yonder young yummy zap zealous " +
  "zebra zen zeppelin zero zestfully zesty zigzagged zipfile zipping zippy " +
  "zips zodiac zone zoning zookeeper zoologist zoology zoom",
].join("").split(" ");

/** A uniform index below `n`, by rejection sampling. */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** `count` random words, separated by spaces. */
export function suggestPassphrase(count = SUGGESTED_WORDS): string {
  return Array.from({ length: count }, () => WORDS[randomBelow(WORDS.length)])
    .join(" ");
}
